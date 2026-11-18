import { brand } from '@brightwork/shared';
import { Landing } from '../ui/landing';
import styles from './pages.module.css';

const pages = [
  [
    '/solutions/websites',
    'Build a website',
    'Plan your pages, edit the copy and publish the version you approve.',
    'Start with a brief for Pip. Preview the draft privately, then approve a specific revision for publication.',
  ],
  [
    '/solutions/selling-online',
    'Sell online',
    'Track Shopify orders or share a checkout link for a Brightwork sale.',
    'Review gross sales and refunds by currency. Checkout for Brightwork sales is currently available in Stripe test mode.',
  ],
  [
    '/solutions/run',
    'Run a project with Pip',
    'Give Pip an outcome, track its research and review proposed actions.',
    'Set a budget before starting. Answer questions as they arrive and pause a run when priorities change.',
  ],
  [
    '/solutions/marketing',
    'Plan a campaign',
    'Turn research into a brief, then review the work before it leaves your workspace.',
    'Save cited findings with your project and keep drafts and approvals together.',
  ],
  [
    '/solutions/ads',
    'Review ad campaigns',
    'Inspect campaign status and control what gets changed.',
    'Campaign activation requires a connected account and an approved budget test. Start by reviewing an existing campaign.',
  ],
  [
    '/solutions/social-media',
    'Manage social replies',
    'Review Facebook Page comments and approve a reply from your workspace.',
    'Connect the Page you manage and keep each conversation alongside the published work.',
  ],
  [
    '/solutions/videos',
    'Generate a short video',
    'Turn a text brief into a short clip when your workspace has video generation enabled.',
    'Build shows the credit price before submission. Download the clip from the workspace after it finishes.',
  ],
  [
    '/solutions/email',
    'Manage email conversations',
    'Read workspace mail, track delivery and approve a reply.',
    'Connect inbound mail to organise messages by conversation. Set up outbound delivery when you are ready to send.',
  ],
  [
    '/solutions/phone',
    'Manage business texts',
    'Receive and review SMS replies on a connected business number.',
    'Bring a Twilio number, review the thread before replying and respect recipient opt-outs.',
  ],
  [
    '/solutions/get-found',
    'Understand where visits come from',
    'See how people arrive and which published pages they open.',
    'Review traffic by source and page over a selected date range.',
  ],
  [
    '/solutions/small-businesses',
    'Give your business one workspace',
    'Plan your website, customer communication and recurring work together.',
    'Invite a colleague and give them a role that matches the decisions they handle.',
  ],
  [
    '/solutions/creators',
    'Run a project as a creator',
    'Put up a portfolio, prepare a launch and keep track of follow-up.',
    'Start with one project brief. Keep media and site drafts in the same workspace so they are easy to find.',
  ],
  [
    '/solutions/side-projects',
    'Move a side project forward',
    'Give an idea a home and choose one useful outcome to work toward.',
    'Use Pip to research a question or draft a page. Schedule recurring work once you know how often it needs doing.',
  ],
  [
    '/integrations',
    'Connect your tools',
    'Use the tools you already have when your workspace needs them.',
    'Brightwork includes connectors for Shopify, Stripe, GitHub, Resend, Twilio, Facebook Pages and selected media providers. Availability depends on workspace setup and provider access.',
  ],
  [
    '/pricing',
    'Plans and usage',
    'Check the credit price before you start metered work.',
    'Available subscriptions appear in Billing when payments are configured. Your credit balance and usage history are available in your account.',
  ],
  [
    '/security',
    'Workspace security',
    'Workspace membership controls access to business information.',
    'Published pages use a separate site domain. Provider credentials are encrypted, and workspace roles determine who can manage connections and approve work.',
  ],
  [
    '/blog',
    'Brightwork guides',
    'Start with a short guide to a task you want to complete.',
    'Read about planning a project with Pip, publishing a site or tracking online sales.',
  ],
  [
    '/ideas',
    'Find a starting idea',
    'Try a project with a clear first deliverable.',
    'Draft a catering landing page, build a portfolio for your prints or write an onboarding checklist for a tutoring service.',
  ],
  [
    '/about',
    'About Brightwork',
    'Brightwork brings site building, customer conversations and repeatable work into one workspace.',
    'Pip helps prepare work for review. The workspace keeps the drafts, decisions and published versions together.',
  ],
  [
    '/careers',
    'Careers at Brightwork',
    'There are no open positions listed here.',
    'Visit About to learn more about the product.',
  ],
  [
    '/community',
    'Learn with Brightwork',
    'Explore ideas and guides before you start your next project.',
    'Choose a guide for your workflow or use an example to start a new workspace.',
  ],
  [
    '/press',
    'Brightwork for press',
    'Product information for journalists and writers.',
    'Read the product overview and explore the workflows available in Brightwork.',
  ],
  [
    '/contact',
    'Contact and account help',
    'Open your account to find the workspace and settings you need.',
    'For sign-in, start with the email address associated with your workspace. The sign-in screen provides a new code on request.',
  ],
] as const;

const byPath = new Map<string, (typeof pages)[number]>(
  pages.map((page) => [page[0], page]),
);
const groups = [
  [
    'Product',
    [
      '/solutions/websites',
      '/solutions/run',
      '/solutions/selling-online',
      '/integrations',
      '/pricing',
    ],
  ],
  ['Resources', ['/ideas', '/blog', '/community', '/security']],
  ['Company', ['/about', '/careers', '/press', '/contact']],
] as const;

export function marketingMetadata(path: string) {
  if (path === '/')
    return {
      title: brand.product,
      description:
        'Build a website and run your business from a Brightwork workspace with Pip.',
    };
  const page = byPath.get(path);
  return (
    page && { title: page[1] + ' | ' + brand.product, description: page[2] }
  );
}

function Links({ paths }: { paths: readonly string[] }) {
  return (
    <ul>
      {paths.map((path) => (
        <li key={path}>
          <a href={path}>{byPath.get(path)?.[1]}</a>
        </li>
      ))}
    </ul>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <nav aria-label="Explore Brightwork">
        {groups.map(([label, paths]) => (
          <section key={label}>
            <h2>{label}</h2>
            <Links paths={paths} />
          </section>
        ))}
      </nav>
    </footer>
  );
}

export function MarketingPage({ path }: { path: string }) {
  const page = byPath.get(path);
  if (path === '/')
    return (
      <>
        <Landing />
        <Footer />
      </>
    );
  if (!page) return null;
  const [, heading, introduction, detail] = page;
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <a className={styles.brand} href="/">
          <img src="/mark.svg" width="28" height="28" alt="" />
          {brand.product}
        </a>
        <nav aria-label="Account">
          <a href="/sign-in">Sign in</a>
          <a className={styles.action} href="/sign-up">
            Start a workspace
          </a>
        </nav>
      </header>
      <main id="main" className={styles.main}>
        <h1>{heading}</h1>
        <p className={styles.lead}>{introduction}</p>
        <p>{detail}</p>
        {path === '/ideas' && (
          <p>
            <a href="/">Try an idea with Pip</a>
          </p>
        )}
        {['/blog', '/integrations', '/community'].includes(path) && (
          <section className={styles.related}>
            <h2>Workflows</h2>
            <Links
              paths={pages
                .filter(([url]) => url.startsWith('/solutions/'))
                .map(([url]) => url)}
            />
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
