import { z } from 'zod';
import { inflateRawSync } from 'node:zlib';

const textAttachment = z.object({
  name: z
    .string()
    .max(160)
    .regex(/^[\p{L}\p{N}_. -]+\.(?:txt|md|csv|json|log)$/iu),
  mimeType: z.literal('text/plain').default('text/plain'),
  content: z
    .string()
    .min(1)
    .max(24576)
    .refine(
      (value) => !value.includes('\0') && Buffer.byteLength(value) <= 24576,
    ),
});

const imageAttachment = z
  .object({
    name: z
      .string()
      .max(160)
      .regex(/^[\p{L}\p{N}_. -]+\.(?:png|jpe?g|webp)$/iu),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    content: z.string().min(8).max(262144),
  })
  .superRefine((file, context) => {
    const encoded = file.content;
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        encoded,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Image must be base64 encoded.',
      });
      return;
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > 192 * 1024 || bytes.toString('base64') !== encoded) {
      context.addIssue({
        code: 'custom',
        message: 'Image exceeds the 192 KB limit.',
      });
      return;
    }
    const valid =
      (file.mimeType === 'image/png' &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (file.mimeType === 'image/jpeg' &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff) ||
      (file.mimeType === 'image/webp' &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP');
    if (!valid)
      context.addIssue({
        code: 'custom',
        message: 'Image content does not match its file type.',
      });
  });

const documentMimeTypes = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
} as const;

const documentAttachment = z
  .object({
    name: z
      .string()
      .max(160)
      .regex(/^[\p{L}\p{N}_. -]+\.(?:pdf|docx|pptx|xlsx|zip)$/iu),
    mimeType: z.enum([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
    ]),
    content: z.string().min(8).max(699052),
  })
  .superRefine((file, context) => {
    const extension = file.name
      .slice(file.name.lastIndexOf('.'))
      .toLowerCase() as keyof typeof documentMimeTypes;
    if (file.mimeType !== documentMimeTypes[extension])
      context.addIssue({
        code: 'custom',
        message: 'File type does not match its name.',
      });
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        file.content,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Document must be base64 encoded.',
      });
      return;
    }
    const bytes = Buffer.from(file.content, 'base64');
    if (
      bytes.length > 512 * 1024 ||
      bytes.toString('base64') !== file.content
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Documents are limited to 512 KB.',
      });
      return;
    }
    const pdf = file.mimeType === 'application/pdf';
    const validSignature = pdf
      ? bytes.toString('ascii', 0, 5) === '%PDF-'
      : [0x04034b50, 0x06054b50, 0x08074b50].includes(bytes.readUInt32LE(0));
    if (!validSignature)
      context.addIssue({
        code: 'custom',
        message: 'File content does not match its type.',
      });
  });

export const chatAttachmentsInput = z
  .array(z.union([textAttachment, imageAttachment, documentAttachment]))
  .max(3)
  .default([]);

type ChatAttachmentPayload = {
  name: string;
  mimeType?: string | undefined;
  content: string;
};

export function sameChatAttachmentPayload(
  first: readonly ChatAttachmentPayload[] = [],
  second: readonly ChatAttachmentPayload[] = [],
) {
  const normalize = (files: readonly ChatAttachmentPayload[]) =>
    files
      .map(({ name, mimeType, content }) => [
        name,
        mimeType ?? 'text/plain',
        content,
      ])
      .sort((left, right) => {
        const a = JSON.stringify(left);
        const b = JSON.stringify(right);
        return a < b ? -1 : a > b ? 1 : 0;
      });
  return JSON.stringify(normalize(first)) === JSON.stringify(normalize(second));
}

type ZipEntry = { name: string; data: Buffer };

const maxExtractedChars = 48_000;
const maxArchiveEntries = 50;
const maxArchiveBytes = 2 * 1024 * 1024;

function checksum32(bytes: Buffer) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++)
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function zipEntries(bytes: Buffer): ZipEntry[] {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const start = Math.max(0, bytes.length - 65_557);
  const end = bytes.lastIndexOf(signature);
  if (end < start || end + 22 > bytes.length)
    throw new Error('The ZIP archive directory is missing or invalid.');
  const disk = bytes.readUInt16LE(end + 4);
  const directoryDisk = bytes.readUInt16LE(end + 6);
  const diskEntries = bytes.readUInt16LE(end + 8);
  const entryCount = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  const commentLength = bytes.readUInt16LE(end + 20);
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    entryCount > maxArchiveEntries ||
    end + 22 + commentLength > bytes.length ||
    directoryOffset + directorySize > end
  )
    throw new Error('This ZIP archive exceeds the supported limits.');

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  let totalExpanded = 0;
  for (let index = 0; index < entryCount; index++) {
    if (
      cursor + 46 > directoryOffset + directorySize ||
      bytes.readUInt32LE(cursor) !== 0x02014b50
    )
      throw new Error('The ZIP archive directory is invalid.');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const expandedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const noteLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + noteLength;
    if (
      next > directoryOffset + directorySize ||
      flags & 1 ||
      ![0, 8].includes(method)
    )
      throw new Error('This ZIP archive uses an unsupported entry format.');
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor = next;
    if (name.endsWith('/')) continue;
    if (
      !name ||
      name.includes('\\') ||
      name.startsWith('/') ||
      name.split('/').some((part) => part === '..')
    )
      throw new Error('This ZIP archive contains an unsafe file path.');
    totalExpanded += expandedSize;
    if (totalExpanded > maxArchiveBytes)
      throw new Error('ZIP contents exceed the 2 MB expanded-size limit.');
    if (
      localOffset + 30 > bytes.length ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    )
      throw new Error('The ZIP archive contains an invalid file entry.');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > bytes.length)
      throw new Error('The ZIP archive contains a truncated file.');
    const compressed = bytes.subarray(dataOffset, dataEnd);
    const data =
      method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: maxArchiveBytes });
    if (data.length !== expandedSize || checksum32(data) !== checksum)
      throw new Error('A ZIP file entry failed its integrity check.');
    entries.push({ name, data });
  }
  return entries;
}

function xmlText(bytes: Buffer) {
  return bytes
    .toString('utf8')
    .replace(/<w:tab\b[^>]*\/>|<a:br\b[^>]*\/>/gu, ' ')
    .replace(/<[^>]+>/gu, '')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/[\t\r\n ]+/gu, ' ')
    .trim();
}

function officeText(name: string, entries: ZipEntry[]) {
  const normalizedName = name.toLowerCase();
  let selected: ZipEntry[];
  if (normalizedName.endsWith('.docx')) {
    selected = entries.filter(({ name: path }) =>
      /^word\/(?:document|header\d*|footer\d*)\.xml$/iu.test(path),
    );
  } else if (normalizedName.endsWith('.pptx')) {
    selected = entries
      .filter(({ name: path }) => /^ppt\/slides\/slide\d+\.xml$/iu.test(path))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  } else {
    selected = entries.filter(({ name: path }) =>
      /^xl\/(?:sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/iu.test(path),
    );
  }
  return selected
    .map(({ name: path, data }) => `${path}: ${xmlText(data)}`)
    .join('\n');
}

async function pdfText(bytes: Buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 25) throw new Error('PDFs are limited to 25 pages.');
    const pages: string[] = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' ')
        .trim();
      if (text) pages.push(`Page ${pageNumber}: ${text}`);
      length += text.length;
      if (length > maxExtractedChars) break;
    }
    return pages.join('\n').slice(0, maxExtractedChars);
  } finally {
    await task.destroy();
  }
}

export async function extractChatAttachment(file: {
  name: string;
  mimeType: string;
  content: string;
}) {
  if (file.mimeType === 'text/plain')
    return file.content.slice(0, maxExtractedChars);
  const bytes = Buffer.from(file.content, 'base64');
  if (file.mimeType === 'application/pdf') {
    const text = await pdfText(bytes);
    return text || 'No selectable text was found in this PDF.';
  }
  const entries = zipEntries(bytes);
  if (entries.length === 0) return 'This ZIP holds no files.';
  if (/\.(?:docx|pptx|xlsx)$/iu.test(file.name)) {
    const text = officeText(file.name, entries);
    return (
      text.slice(0, maxExtractedChars) ||
      'No readable text was found in this document.'
    );
  }
  const snippets = entries
    .filter(({ name }) => /\.(?:txt|md|csv|json|log)$/iu.test(name))
    .slice(0, 25)
    .map(
      ({ name, data }) => `${name}\n${data.toString('utf8').slice(0, 8000)}`,
    );
  const listing = entries.map(({ name }) => name).join('\n');
  return [
    `Archive files (${entries.length}):\n${listing}`,
    snippets.length ? `Readable file contents:\n${snippets.join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxExtractedChars);
}
