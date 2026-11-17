import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/primitives';

type Recognition = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

export function Dictation({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (transcript: string) => void;
}) {
  const recognizer = useRef<Recognition | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const browser = (typeof window === 'undefined' ? undefined : window) as
    | undefined
    | (typeof window & {
        SpeechRecognition?: new () => Recognition;
        webkitSpeechRecognition?: new () => Recognition;
      });
  const SpeechRecognition =
    browser?.SpeechRecognition ?? browser?.webkitSpeechRecognition;

  useEffect(
    () => () => {
      const active = recognizer.current;
      if (active) {
        active.onresult = null;
        active.onerror = null;
        active.onend = null;
        active.abort();
      }
    },
    [],
  );

  if (!SpeechRecognition) return null;

  function begin(Provider: new () => Recognition) {
    if (recognizer.current) {
      recognizer.current.stop();
      return;
    }
    setError('');
    try {
      const next = new Provider();
      recognizer.current = next;
      next.onresult = ({ results }) => {
        const transcript = Array.from(
          results,
          (result) => result[0]?.transcript ?? '',
        )
          .join(' ')
          .trim();
        if (transcript) onTranscript(transcript);
      };
      next.onerror = () =>
        setError('Dictation stopped. Check your microphone or type a message.');
      next.onend = () => {
        recognizer.current = null;
        setRecording(false);
      };
      next.start();
      setRecording(true);
    } catch {
      recognizer.current = null;
      setRecording(false);
      setError('Could not start dictation. Check your microphone.');
    }
  }

  return (
    <>
      <Button
        type="button"
        size="small"
        variant="secondary"
        disabled={disabled && !recording}
        aria-pressed={recording}
        onClick={() => begin(SpeechRecognition)}
      >
        {recording ? 'Stop dictation' : 'Dictate'}
      </Button>
      {recording && <span role="status">Listening with your browser…</span>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
