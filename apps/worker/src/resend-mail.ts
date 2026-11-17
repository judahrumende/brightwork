import { z } from 'zod';
import type { EmailAttempt, EmailResult } from '@brightwork/api/mail';

export function resendMail(key: string, request = fetch) {
  return async function send(attempt: EmailAttempt): Promise<EmailResult> {
    try {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'brightwork-email-' + attempt.id,
        },
        body: JSON.stringify({
          from: attempt.sender,
          to: [attempt.recipient],
          subject: attempt.subject,
          text: attempt.body,
          ...(attempt.replyTo ? { reply_to: [attempt.replyTo] } : {}),
          ...(attempt.inReplyTo
            ? {
                headers: {
                  'In-Reply-To': attempt.inReplyTo,
                  References: attempt.inReplyTo,
                },
              }
            : {}),
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(25_000),
      });
      if (response.ok) {
        const { id } = z
          .object({ id: z.string().min(1) })
          .parse(await response.json());
        return { kind: 'accepted', id };
      }
      await response.body?.cancel();
      if ([408, 409, 429].includes(response.status) || response.status >= 500)
        return {
          kind: 'retry',
          note: 'The email provider did not confirm acceptance.',
        };
      return {
        kind: 'rejected',
        note: 'The email provider rejected this request. Check the sender and recipient.',
      };
    } catch {
      return {
        kind: 'retry',
        note: 'The email provider did not confirm acceptance.',
      };
    }
  };
}
