import { useState } from 'react';
import type { FormEvent } from 'react';
import { brand } from '@brightwork/shared';
import { Sky } from '../sky/sky';
import { Mascot, Icon } from './icons';
import { Button } from './primitives';
import styles from './landing.module.css';

const examples = [
  'Build a website for my catering business',
  'Plan a shop for my original prints',
  'Draft a launch plan for my tutoring service',
];

export function Landing() {
  const [idea, setIdea] = useState('');
  const [choice, setChoice] = useState(0);
  function start(event: FormEvent) {
    event.preventDefault();
    if (!idea.trim()) return;
    try {
      sessionStorage.setItem('brightwork-idea', idea.trim());
    } catch {
      /* The user can re-enter the idea after signup. */
    }
    location.assign('/new');
  }
  return (
    <main className={styles.page}>
      <Sky scene="landing" />
      <header className={styles.nav}>
        <a className={styles.brand} href="/">
          <img src="/mark.svg" width="26" height="26" alt="" />
          {brand.product}
        </a>
        <nav aria-label="Account">
          <a href="/sign-in">Log in</a>
          <Button asChild>
            <a href="/sign-up">Start free</a>
          </Button>
        </nav>
      </header>
      <section className={styles.hero}>
        <Mascot size={90} />
        <h1>Build a business with an AI operator.</h1>
        <p>
          Meet {brand.agent}, your teammate for building and running a business.
        </p>
        <form onSubmit={start} className={styles.prompt}>
          <textarea
            aria-label="Your business idea"
            value={idea}
            maxLength={4000}
            placeholder={`Ask ${brand.agent} to build a website for…`}
            onChange={(event) => setIdea(event.currentTarget.value)}
            required
          />
          <div>
            <button
              type="button"
              className={styles.example}
              onClick={() => {
                setIdea(examples[choice] ?? '');
                setChoice((index) => (index + 1) % examples.length);
              }}
            >
              Try an idea
            </button>
            <Button
              size="icon"
              aria-label="Start with this idea"
              type="submit"
              disabled={!idea.trim()}
            >
              <Icon name="arrow" />
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
