import { Link } from '@tanstack/react-router';
import { Sky } from '../sky/sky';
import { Mascot } from './icons';
import styles from './ui-gallery.module.css';

export function PreviewLink({ title }: { title: string }) {
  return (
    <main className={styles.welcome}>
      <Sky scene="landing" />
      <Mascot size={80} />
      <h1>{title}</h1>
      <Link to="/dev/ui">Open the UI preview</Link>
    </main>
  );
}
