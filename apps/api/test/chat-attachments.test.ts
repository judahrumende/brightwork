import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  chatAttachmentsInput,
  extractChatAttachment,
} from '../src/workspace/chat-attachments';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p7sAAAAASUVORK5CYII=';

function crc32(bytes: Buffer) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++)
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; text: string }[]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const expanded = Buffer.from(file.text, 'utf8');
    const compressed = deflateRawSync(expanded);
    const checksum = crc32(expanded);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(expanded.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(expanded.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(localOffset, 42);
    central.push(record, name);
    localOffset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...local, directory, end]);
}

function pdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  output += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output);
}

test('chat attachments accept bounded text and supported raster images', () => {
  const result = chatAttachmentsInput.parse([
    { name: 'brief.md', content: 'A short project brief.' },
    { name: 'photo.png', mimeType: 'image/png', content: png },
  ]);
  assert.equal(result[0]?.mimeType, 'text/plain');
  assert.equal(result[1]?.mimeType, 'image/png');
});

test('chat attachments reject unsupported types, spoofed images, and excess files', () => {
  assert.equal(
    chatAttachmentsInput.safeParse([
      {
        name: 'program.exe',
        mimeType: 'application/octet-stream',
        content: 'fixture',
      },
    ]).success,
    false,
  );
  assert.equal(
    chatAttachmentsInput.safeParse([
      { name: 'photo.png', mimeType: 'image/png', content: 'bm90IGFuIGltYWdl' },
    ]).success,
    false,
  );
  assert.equal(
    chatAttachmentsInput.safeParse(
      Array.from({ length: 4 }, (_, index) => ({
        name: `brief-${index}.txt`,
        content: 'fixture',
      })),
    ).success,
    false,
  );
});

test('chat image attachments enforce the encoded size limit', () => {
  const oversized = Buffer.alloc(192 * 1024 + 1).toString('base64');
  assert.equal(
    chatAttachmentsInput.safeParse([
      { name: 'large.png', mimeType: 'image/png', content: oversized },
    ]).success,
    false,
  );
});

test('chat document attachments accept 512 KiB and reject the next byte', () => {
  const atLimit = Buffer.alloc(512 * 1024, 0x61);
  atLimit.write('%PDF-');
  assert.equal(
    chatAttachmentsInput.safeParse([
      {
        name: 'boundary.pdf',
        mimeType: 'application/pdf',
        content: atLimit.toString('base64'),
      },
    ]).success,
    true,
  );

  const overLimit = Buffer.alloc(512 * 1024 + 1, 0x61);
  overLimit.write('%PDF-');
  assert.equal(
    chatAttachmentsInput.safeParse([
      {
        name: 'oversized.pdf',
        mimeType: 'application/pdf',
        content: overLimit.toString('base64'),
      },
    ]).success,
    false,
  );
});

test('chat attachments extract bounded text from PDFs and ZIP archives', async () => {
  const pdfContent = pdf('Quarterly plan text.').toString('base64');
  const pdfFile = chatAttachmentsInput.parse([
    {
      name: 'plan.pdf',
      mimeType: 'application/pdf',
      content: pdfContent,
    },
  ])[0];
  assert.ok(pdfFile);
  assert.match(await extractChatAttachment(pdfFile), /Quarterly plan text/u);

  const archive = zip([
    { name: 'notes/brief.txt', text: 'Archive project notes.' },
    { name: 'image.bin', text: 'binary fixture' },
  ]);
  const zipFile = chatAttachmentsInput.parse([
    {
      name: 'brief.zip',
      mimeType: 'application/zip',
      content: archive.toString('base64'),
    },
  ])[0];
  assert.ok(zipFile);
  const extracted = await extractChatAttachment(zipFile);
  assert.match(extracted, /notes\/brief\.txt/u);
  assert.match(extracted, /Archive project notes\./u);

  const docx = zip([
    {
      name: 'word/document.xml',
      text: '<w:document><w:p><w:r><w:t>Word document text.</w:t></w:r></w:p></w:document>',
    },
  ]);
  const wordFile = chatAttachmentsInput.parse([
    {
      name: 'brief.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      content: docx.toString('base64'),
    },
  ])[0];
  assert.ok(wordFile);
  assert.match(await extractChatAttachment(wordFile), /Word document text\./u);

  const workbook = zip([
    {
      name: 'xl/sharedStrings.xml',
      text: '<sst><si><t>Campaign budget</t></si></sst>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      text: '<worksheet><row><c><v>250</v></c></row></worksheet>',
    },
  ]);
  const workbookFile = chatAttachmentsInput.parse([
    {
      name: 'budget.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: workbook.toString('base64'),
    },
  ])[0];
  assert.ok(workbookFile);
  const workbookText = await extractChatAttachment(workbookFile);
  assert.match(workbookText, /Campaign budget/u);
  assert.match(workbookText, /250/u);

  const slides = zip([
    {
      name: 'ppt/slides/slide1.xml',
      text: '<p:sld><a:t>Launch goals</a:t></p:sld>',
    },
  ]);
  const slideFile = chatAttachmentsInput.parse([
    {
      name: 'launch.pptx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      content: slides.toString('base64'),
    },
  ])[0];
  assert.ok(slideFile);
  assert.match(await extractChatAttachment(slideFile), /Launch goals/u);
});

test('chat document extraction rejects malformed and oversized ZIP contents', async () => {
  const malformed = chatAttachmentsInput.parse([
    {
      name: 'broken.zip',
      mimeType: 'application/zip',
      content: Buffer.from('PK\x03\x04bad archive').toString('base64'),
    },
  ])[0];
  assert.ok(malformed);
  await assert.rejects(extractChatAttachment(malformed), /ZIP archive/u);

  const unsafePath = zip([{ name: '../private.txt', text: 'must not read' }]);
  const unsafe = chatAttachmentsInput.parse([
    {
      name: 'unsafe.zip',
      mimeType: 'application/zip',
      content: unsafePath.toString('base64'),
    },
  ])[0];
  assert.ok(unsafe);
  await assert.rejects(extractChatAttachment(unsafe), /unsafe file path/u);

  const bomb = zip([
    { name: 'large.txt', text: 'A'.repeat(2 * 1024 * 1024 + 1) },
  ]);
  const oversized = chatAttachmentsInput.parse([
    {
      name: 'large.zip',
      mimeType: 'application/zip',
      content: bomb.toString('base64'),
    },
  ])[0];
  assert.ok(oversized);
  await assert.rejects(
    extractChatAttachment(oversized),
    /expanded-size limit/u,
  );

  const empty = zip([]);
  const emptyZip = chatAttachmentsInput.parse([
    {
      name: 'empty.zip',
      mimeType: 'application/zip',
      content: empty.toString('base64'),
    },
  ])[0];
  assert.ok(emptyZip);
  assert.equal(
    await extractChatAttachment(emptyZip),
    'This ZIP holds no files.',
  );
});
