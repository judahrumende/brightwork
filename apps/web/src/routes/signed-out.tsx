import { createFileRoute } from '@tanstack/react-router';
import { Sky } from '../sky/sky';
import styles from '../workbench/workbench.module.css';

export const Route = createFileRoute('/signed-out')({
  component: () => (
    <main className={styles.centered}>
      <Sky scene="quiet" />
      <div className={styles.centerCard}>
        <h1>You’re logged out</h1>
        <a href="/sign-in">Log in again</a>
      </div>
    </main>
  ),
});
