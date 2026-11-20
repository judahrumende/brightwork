import type {
  generatedAppJobs,
  AppJobClaim,
} from '@brightwork/api/generated-app-jobs';
import type { generatedAppRecords } from '@brightwork/api/generated-app-records';
import type { generatedAppUserDirectory } from '@brightwork/api/generated-app-users';

export async function processGeneratedAppJob(
  claim: AppJobClaim,
  dependencies: {
    jobs: Pick<
      ReturnType<typeof generatedAppJobs>,
      'current' | 'finish' | 'retry'
    >;
    records: ReturnType<typeof generatedAppRecords>;
    users: ReturnType<typeof generatedAppUserDirectory>;
  },
) {
  const { jobs, records, users } = dependencies;
  try {
    if (!(await jobs.current(claim))) {
      await jobs.finish(claim, 'This app revision is no longer active.');
      return 'failed' as const;
    }
    const user =
      claim.environment === 'preview'
        ? { id: claim.actorId, email: claim.actorEmail, role: 'admin' as const }
        : await users.byEmail(claim.siteId, claim.actorEmail);
    if (!user) {
      await jobs.finish(claim, 'The app user no longer exists.');
      return 'failed' as const;
    }
    const preview =
      claim.environment === 'preview'
        ? { businessId: claim.businessId, revision: claim.dataRevision }
        : undefined;
    const changed = await records.publicAction(
      claim.siteId,
      claim.recordId,
      claim.action,
      claim.collection,
      user,
      preview,
    );
    await jobs.finish(
      claim,
      changed ? undefined : 'The workflow action is no longer available.',
    );
    return changed ? ('succeeded' as const) : ('failed' as const);
  } catch {
    await jobs.retry(claim).catch(() => false);
    return 'retry' as const;
  }
}
