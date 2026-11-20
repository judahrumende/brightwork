import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, write } from '../auth/client';
import { Button, EmptyState, Segmented } from '../ui/primitives';
import styles from './store-dashboard.module.css';

type RecordRow = {
  id: string;
  collection: string;
  data: Record<string, unknown>;
  updatedAt: string;
};
type RecordCursor = { before: string; id: string };
type JobCursor = { runAt: string; createdAt: string; id: string };
type AppUser = { id: string; email: string; role: 'user' | 'admin' };
type AppInvitation = {
  email: string;
  role: 'user' | 'admin';
  expiresAt: string;
};
type Collection = {
  name: string;
  readAccess: 'public' | 'authenticated' | 'admin';
  writeAccess: 'public' | 'authenticated' | 'admin';
  ownerScoped: boolean;
  fields: {
    name: string;
    type: 'text' | 'number' | 'boolean' | 'date';
    required: boolean;
    unique?: boolean;
    defaultValue?: string | number | boolean;
  }[];
  actions: {
    name: string;
    label: string;
    field: string;
    value: string | number | boolean;
  }[];
};
type Activity = {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  createdAt: string;
};
type AppFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  ownerEmail: string;
  createdAt: string;
};
type AppJob = {
  id: string;
  actorEmail: string;
  collection: string;
  recordId: string;
  action: string;
  runAt: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number;
  lastError: string;
  createdAt: string;
  completedAt: string | null;
};
type AppAnalytics = {
  recordCount: number;
  userCount: number;
  fileCount: number;
  storageBytes: string;
  storageCredits: string;
  storageCreditsPerMib: string;
  collectionCount: number;
  activityLast7Days: number;
  modelCredits: number;
  toolCredits: number;
  totalCredits: number;
  mediaJobs: number;
  mediaCredits: string;
};
type AppSource = {
  revision: number;
  sourceFiles: { path: string; content: string }[];
  sourceHash: string;
  buildState: 'unverified' | 'queued' | 'building' | 'passed' | 'failed';
  buildLog: string;
};
type GithubSync = { repo: string; branch: string };
const accessOptions = ['public', 'authenticated', 'admin'].map((value) => ({
  label: value,
  value,
}));

export function AppDashboard({
  endpoint,
  title,
  onReturn,
  readOnly,
}: {
  endpoint: string;
  title: string;
  onReturn: () => void;
  readOnly: boolean;
}) {
  const cache = useQueryClient();
  const [section, setSection] = useState('Overview');
  const [collection, setCollection] = useState('records');
  const [recordPages, setRecordPages] = useState<(RecordCursor | undefined)[]>([
    undefined,
  ]);
  const [filePages, setFilePages] = useState<(RecordCursor | undefined)[]>([
    undefined,
  ]);
  const [jobPages, setJobPages] = useState<(JobCursor | undefined)[]>([
    undefined,
  ]);
  const [userPages, setUserPages] = useState<(RecordCursor | undefined)[]>([
    undefined,
  ]);
  const [invitationPages, setInvitationPages] = useState<
    (RecordCursor | undefined)[]
  >([undefined]);
  const [activityPages, setActivityPages] = useState<
    (RecordCursor | undefined)[]
  >([undefined]);
  const [draft, setDraft] = useState('{\n  \n}');
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [newCollection, setNewCollection] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'user' | 'admin'>('user');
  const [workflowDrafts, setWorkflowDrafts] = useState<Record<string, string>>(
    {},
  );
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({});
  const [migrationDrafts, setMigrationDrafts] = useState<
    Record<string, string>
  >({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [sourceSync, setSourceSync] = useState<{
    url: string;
    changed: boolean;
  } | null>(null);
  const [syncingSource, setSyncingSource] = useState(false);
  const collections = useQuery({
    queryKey: ['app-dashboard', endpoint, 'collections'],
    queryFn: ({ signal }) =>
      api<{ collections: Collection[] }>(endpoint + '/collections', { signal }),
  });
  const recordCursor = recordPages.at(-1);
  const records = useQuery({
    queryKey: ['app-dashboard', endpoint, 'records', collection, recordCursor],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ collection });
      if (recordCursor) {
        query.set('before', recordCursor.before);
        query.set('id', recordCursor.id);
      }
      return api<{ records: RecordRow[]; next: RecordCursor | null }>(
        endpoint + '/records?' + query,
        { signal },
      );
    },
    enabled: section === 'Data' || section === 'Overview',
  });
  const userCursor = userPages.at(-1);
  const invitationCursor = invitationPages.at(-1);
  const users = useQuery({
    queryKey: [
      'app-dashboard',
      endpoint,
      'users',
      userCursor,
      invitationCursor,
    ],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams();
      if (userCursor) {
        query.set('usersBefore', userCursor.before);
        query.set('usersId', userCursor.id);
      }
      if (invitationCursor) {
        query.set('invitationsBefore', invitationCursor.before);
        query.set('invitationsId', invitationCursor.id);
      }
      return api<{
        users: AppUser[];
        invitations: AppInvitation[];
        nextUsers: RecordCursor | null;
        nextInvitations: RecordCursor | null;
      }>(endpoint + '/users' + (query.size ? '?' + query : ''), { signal });
    },
    enabled: section === 'Users' || section === 'Overview',
  });
  const activityCursor = activityPages.at(-1);
  const activity = useQuery({
    queryKey: ['app-dashboard', endpoint, 'activity', activityCursor],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams();
      if (activityCursor) {
        query.set('before', activityCursor.before);
        query.set('id', activityCursor.id);
      }
      return api<{ activity: Activity[]; next: RecordCursor | null }>(
        endpoint + '/activity' + (query.size ? '?' + query : ''),
        { signal },
      );
    },
    enabled: section === 'Logs',
  });
  const fileCursor = filePages.at(-1);
  const files = useQuery({
    queryKey: ['app-dashboard', endpoint, 'files', fileCursor],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams();
      if (fileCursor) {
        query.set('before', fileCursor.before);
        query.set('id', fileCursor.id);
      }
      return api<{ files: AppFile[]; next: RecordCursor | null }>(
        endpoint + '/files' + (query.size ? '?' + query : ''),
        { signal },
      );
    },
    enabled: section === 'Files',
  });
  const jobCursor = jobPages.at(-1);
  const jobs = useQuery({
    queryKey: ['app-dashboard', endpoint, 'jobs', jobCursor],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams();
      if (jobCursor) {
        query.set('runAt', jobCursor.runAt);
        query.set('createdAt', jobCursor.createdAt);
        query.set('id', jobCursor.id);
      }
      return api<{ jobs: AppJob[]; next: JobCursor | null }>(
        endpoint + '/jobs' + (query.size ? '?' + query : ''),
        { signal },
      );
    },
    enabled: section === 'Jobs',
  });
  const analytics = useQuery({
    queryKey: ['app-dashboard', endpoint, 'analytics'],
    queryFn: ({ signal }) =>
      api<{ analytics: AppAnalytics }>(endpoint + '/analytics', { signal }),
    enabled: section === 'Analytics',
  });
  const source = useQuery({
    queryKey: ['app-dashboard', endpoint, 'code'],
    queryFn: ({ signal }) =>
      api<{ source: AppSource | null; github: GithubSync | null }>(
        endpoint + '/code',
        { signal },
      ),
    enabled: section === 'Code' && !readOnly,
    refetchInterval: (query) =>
      query.state.data?.source?.buildState === 'queued' ||
      query.state.data?.source?.buildState === 'building'
        ? 2_000
        : false,
  });
  async function mutate(path: string, body: object, method = 'PUT') {
    setError('');
    setNotice('');
    try {
      await write(path, body, method);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['app-dashboard', endpoint] }),
      ]);
      setNotice('Changes saved.');
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    }
  }
  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const data: unknown = JSON.parse(draft);
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Enter a JSON object.');
      await mutate(
        endpoint +
          '/records' +
          (editingRecordId ? '/' + editingRecordId : '') +
          '?collection=' +
          encodeURIComponent(collection),
        data as object,
      );
      setEditingRecordId(null);
      setDraft('{\n  \n}');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Enter a valid JSON object.',
      );
    }
  }
  async function downloadFile(file: AppFile) {
    try {
      const result = await api<{
        file: { name: string; mime: string; data: string };
      }>(endpoint + '/files/' + file.id);
      const binary = atob(result.file.data);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: result.file.mime }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  function downloadSource(source: AppSource) {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: 'foundable-app-source-v1',
              revision: source.revision,
              sourceHash: source.sourceHash,
              build: {
                runtime: 'node24',
                framework: 'vite-react-typescript',
                entrypoint: 'src/main.tsx',
                commands: ['npm install', 'npm run typecheck', 'npm run build'],
                output: 'dist/preview.html',
              },
              files: source.sourceFiles,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `foundable-app-r${source.revision}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  async function syncSourceRevision(revision: number) {
    setError('');
    setSourceSync(null);
    setSyncingSource(true);
    try {
      setSourceSync(
        await write<{ url: string; changed: boolean }>(
          endpoint + '/code/github',
          { revision },
        ),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSyncingSource(false);
    }
  }
  const tabs = [
    'Overview',
    'Analytics',
    'Data',
    'Files',
    'Jobs',
    'Users',
    'Collections',
    'Logs',
    ...(!readOnly ? ['Code'] : []),
  ];
  return (
    <section className={styles.dashboard} aria-label={title + ' app dashboard'}>
      <div className={styles.toolbar}>
        <div>
          <h3>{title} dashboard</h3>
          <p>Manage app data, access, and users.</p>
        </div>
        <Button variant="secondary" onClick={onReturn}>
          Back to preview
        </Button>
      </div>
      <Segmented
        label="App dashboard sections"
        options={tabs.map((value) => ({ label: value, value }))}
        value={section}
        onValueChange={setSection}
      />
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {section === 'Overview' && (
        <>
          {(collections.isError || records.isError || users.isError) && (
            <p role="alert">
              {errorMessage(collections.error ?? records.error ?? users.error)}
            </p>
          )}
          <dl className={styles.metrics}>
            <div>
              <dt>Collections</dt>
              <dd>{collections.data?.collections.length ?? '—'}</dd>
            </div>
            <div>
              <dt>Records in {collection}</dt>
              <dd>{records.data?.records.length ?? '—'}</dd>
            </div>
            <div>
              <dt>App users</dt>
              <dd>{users.data?.users.length ?? '—'}</dd>
            </div>
          </dl>
          <p>
            Choose Data to manage records, Users to manage roles, or Collections
            to set access rules.
          </p>
        </>
      )}
      {section === 'Data' && (
        <>
          {(collections.isError || records.isError) && (
            <p role="alert">
              {errorMessage(collections.error ?? records.error)}
            </p>
          )}
          {(collections.isPending || records.isPending) && (
            <p role="status">Loading app data…</p>
          )}
          <label>
            Collection{' '}
            <select
              value={collection}
              onChange={(event) => {
                setCollection(event.target.value);
                setRecordPages([undefined]);
              }}
            >
              {(
                collections.data?.collections ?? [
                  { name: 'records' } as Collection,
                ]
              ).map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
          </label>
          <form
            className={styles.form}
            onSubmit={(event) => void saveRecord(event)}
          >
            {collections.data?.collections
              .find((item) => item.name === collection)
              ?.fields.map((field) => (
                <p key={field.name}>
                  <code>{field.name}</code> · {field.type}
                  {field.required ? ' · required' : ''}
                </p>
              ))}
            <label>
              {editingRecordId
                ? 'Edit record data (JSON)'
                : 'New record data (JSON)'}
              <textarea
                rows={6}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <Button type="submit" disabled={readOnly}>
                {editingRecordId ? 'Save record' : 'Add record'}
              </Button>
              {editingRecordId && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingRecordId(null);
                    setDraft('{\n  \n}');
                  }}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </form>
          {records.isSuccess && records.data.records.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Data</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {records.data.records.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code>{row.id.slice(0, 8)}</code>
                      </td>
                      <td>
                        <pre>{JSON.stringify(row.data, null, 2)}</pre>
                      </td>
                      <td>{new Date(row.updatedAt).toLocaleString()}</td>
                      <td>
                        <div className={styles.actions}>
                          <Button
                            variant="secondary"
                            size="small"
                            disabled={readOnly}
                            onClick={() => {
                              setEditingRecordId(row.id);
                              setDraft(JSON.stringify(row.data, null, 2));
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="small"
                            disabled={readOnly}
                            onClick={() =>
                              void mutate(
                                endpoint +
                                  '/records/' +
                                  row.id +
                                  '?collection=' +
                                  encodeURIComponent(collection),
                                {},
                                'DELETE',
                              )
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : records.isSuccess ? (
            <EmptyState
              title="No records yet"
              description="Add a JSON record to start using this collection."
            />
          ) : null}
          {records.isSuccess && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={recordPages.length === 1 || records.isFetching}
                onClick={() => setRecordPages(recordPages.slice(0, -1))}
              >
                Previous
              </Button>
              <span>Page {recordPages.length}</span>
              <Button
                variant="secondary"
                disabled={!records.data.next || records.isFetching}
                onClick={() => {
                  if (records.data.next)
                    setRecordPages([...recordPages, records.data.next]);
                }}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
      {section === 'Files' && (
        <>
          {files.isError && <p role="alert">{errorMessage(files.error)}</p>}
          {files.isPending && <p role="status">Loading app files…</p>}
          {files.isSuccess && files.data.files.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Uploaded by</th>
                    <th>Uploaded</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {files.data.files.map((file) => (
                    <tr key={file.id}>
                      <td>{file.name}</td>
                      <td>{file.mime}</td>
                      <td>{file.size.toLocaleString()} bytes</td>
                      <td>{file.ownerEmail}</td>
                      <td>{new Date(file.createdAt).toLocaleString()}</td>
                      <td>
                        <div className={styles.actions}>
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={() => void downloadFile(file)}
                          >
                            Download
                          </Button>
                          <Button
                            variant="danger"
                            size="small"
                            disabled={readOnly}
                            onClick={() =>
                              void mutate(
                                endpoint + '/files/' + file.id,
                                {},
                                'DELETE',
                              )
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : files.isSuccess ? (
            <EmptyState
              title="No files yet"
              description="Files uploaded by signed-in app users will appear here."
            />
          ) : null}
          {files.isSuccess && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={filePages.length === 1 || files.isFetching}
                onClick={() => setFilePages(filePages.slice(0, -1))}
              >
                Previous
              </Button>
              <span>Page {filePages.length}</span>
              <Button
                variant="secondary"
                disabled={!files.data.next || files.isFetching}
                onClick={() => {
                  if (files.data.next)
                    setFilePages([...filePages, files.data.next]);
                }}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
      {section === 'Jobs' && (
        <>
          {jobs.isError && <p role="alert">{errorMessage(jobs.error)}</p>}
          {jobs.isPending && <p role="status">Loading background jobs…</p>}
          {jobs.isSuccess && jobs.data.jobs.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Scheduled action</th>
                    <th>Record</th>
                    <th>Run time</th>
                    <th>Status</th>
                    <th>Requested by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jobs.data.jobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        {job.collection} · {job.action}
                        {job.lastError && <p role="alert">{job.lastError}</p>}
                      </td>
                      <td>
                        <code>{job.recordId.slice(0, 8)}</code>
                      </td>
                      <td>{new Date(job.runAt).toLocaleString()}</td>
                      <td className={styles.status}>{job.state}</td>
                      <td>{job.actorEmail}</td>
                      <td>
                        {job.state === 'queued' && (
                          <Button
                            variant="danger"
                            size="small"
                            disabled={readOnly}
                            onClick={() =>
                              void mutate(
                                endpoint + '/jobs/' + job.id,
                                {},
                                'DELETE',
                              )
                            }
                          >
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : jobs.isSuccess ? (
            <EmptyState
              title="No background jobs"
              description="Scheduled workflow actions will appear here."
            />
          ) : null}
          {jobs.isSuccess && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={jobPages.length === 1 || jobs.isFetching}
                onClick={() => setJobPages(jobPages.slice(0, -1))}
              >
                Previous
              </Button>
              <span>Page {jobPages.length}</span>
              <Button
                variant="secondary"
                disabled={!jobs.data.next || jobs.isFetching}
                onClick={() => {
                  if (jobs.data.next)
                    setJobPages([...jobPages, jobs.data.next]);
                }}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
      {section === 'Users' && (
        <>
          {users.isError && <p role="alert">{errorMessage(users.error)}</p>}
          {users.isPending && <p role="status">Loading app users…</p>}
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (!inviteEmail.trim()) return;
              void mutate(
                endpoint + '/users/invitations',
                { email: inviteEmail, role: inviteRole },
                'POST',
              ).then((saved) => {
                if (saved) {
                  setInviteEmail('');
                  setInviteRole('user');
                }
              });
            }}
          >
            <h4>Invite user</h4>
            <label>
              Email
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </label>
            <label>
              Role
              <select
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as 'user' | 'admin')
                }
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <Button type="submit" disabled={readOnly || !inviteEmail.trim()}>
              Send invite
            </Button>
            <p>
              The invitee receives an email sign-in code. Admin access starts
              after they verify their email.
            </p>
          </form>
          {users.data?.invitations.length ? (
            <div className={styles.table}>
              <h4>Pending invitations</h4>
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.invitations.map((invitation) => (
                    <tr key={invitation.email}>
                      <td>{invitation.email}</td>
                      <td>{invitation.role}</td>
                      <td>{new Date(invitation.expiresAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {users.isSuccess && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={invitationPages.length === 1 || users.isFetching}
                onClick={() => setInvitationPages(invitationPages.slice(0, -1))}
              >
                Previous invitations
              </Button>
              <span>Page {invitationPages.length}</span>
              <Button
                variant="secondary"
                disabled={!users.data.nextInvitations || users.isFetching}
                onClick={() =>
                  users.data.nextInvitations &&
                  setInvitationPages([
                    ...invitationPages,
                    users.data.nextInvitations,
                  ])
                }
              >
                Next invitations
              </Button>
            </div>
          )}
          {users.isSuccess && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={userPages.length === 1 || users.isFetching}
                onClick={() => setUserPages(userPages.slice(0, -1))}
              >
                Previous users
              </Button>
              <span>Page {userPages.length}</span>
              <Button
                variant="secondary"
                disabled={!users.data.nextUsers || users.isFetching}
                onClick={() =>
                  users.data.nextUsers &&
                  setUserPages([...userPages, users.data.nextUsers])
                }
              >
                Next users
              </Button>
            </div>
          )}
          {users.isSuccess && users.data.users.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>{user.role}</td>
                      <td>
                        <div className={styles.actions}>
                          <Button
                            size="small"
                            variant="secondary"
                            disabled={readOnly}
                            onClick={() =>
                              void mutate(
                                endpoint + '/users/' + user.id,
                                {
                                  role:
                                    user.role === 'admin' ? 'user' : 'admin',
                                },
                                'PATCH',
                              )
                            }
                          >
                            {user.role === 'admin' ? 'Make user' : 'Make admin'}
                          </Button>
                          <Button
                            size="small"
                            variant="danger"
                            disabled={readOnly}
                            onClick={() =>
                              void mutate(
                                endpoint + '/users/' + user.id,
                                {},
                                'DELETE',
                              )
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : users.isSuccess ? (
            <EmptyState
              title="No app users yet"
              description="Users appear after they sign in through your generated app."
            />
          ) : null}
        </>
      )}
      {section === 'Collections' && (
        <>
          {collections.isError && (
            <p role="alert">{errorMessage(collections.error)}</p>
          )}
          {collections.isPending && <p role="status">Loading collections…</p>}
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (!newCollection.trim()) return;
              void mutate(
                endpoint +
                  '/collections/' +
                  encodeURIComponent(newCollection.trim()),
                {
                  readAccess: 'authenticated',
                  writeAccess: 'authenticated',
                  ownerScoped: true,
                },
              ).then(() => setNewCollection(''));
            }}
          >
            <label>
              Collection name
              <input
                value={newCollection}
                onChange={(event) =>
                  setNewCollection(
                    event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_-]/g, ''),
                  )
                }
                placeholder="orders"
              />
            </label>
            <Button type="submit" disabled={readOnly || !newCollection}>
              Create collection
            </Button>
          </form>
          {collections.data?.collections.map((item) => (
            <div className={styles.form} key={item.name}>
              <strong>{item.name}</strong>
              {item.fields.map((field) => (
                <p key={field.name}>
                  <code>{field.name}</code> · {field.type}
                  {field.required ? ' · required' : ''}
                </p>
              ))}
              <label>
                Collection fields (JSON)
                <textarea
                  rows={5}
                  aria-label={item.name + ' collection fields'}
                  value={
                    fieldDrafts[item.name] ??
                    JSON.stringify(item.fields, null, 2)
                  }
                  onChange={(event) =>
                    setFieldDrafts((drafts) => ({
                      ...drafts,
                      [item.name]: event.target.value,
                    }))
                  }
                />
              </label>
              <p>
                Saving validates existing live records. Declared defaults fill
                missing values; incompatible changes are rejected without
                changing the saved schema.
              </p>
              <label>
                One-time live data migrations (JSON)
                <textarea
                  rows={4}
                  aria-label={item.name + ' one-time data migrations'}
                  placeholder={
                    '[{"operation":"copyField","from":"old_name","to":"new_name"}]'
                  }
                  value={migrationDrafts[item.name] ?? ''}
                  onChange={(event) =>
                    setMigrationDrafts((drafts) => ({
                      ...drafts,
                      [item.name]: event.target.value,
                    }))
                  }
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={readOnly}
                onClick={() => {
                  try {
                    const fields: unknown = JSON.parse(
                      fieldDrafts[item.name] ?? JSON.stringify(item.fields),
                    );
                    if (!Array.isArray(fields))
                      throw new Error('Fields must be a JSON array.');
                    const migrations: unknown = JSON.parse(
                      migrationDrafts[item.name] || '[]',
                    );
                    if (!Array.isArray(migrations))
                      throw new Error('Migrations must be a JSON array.');
                    void mutate(
                      endpoint +
                        '/collections/' +
                        encodeURIComponent(item.name),
                      {
                        readAccess: item.readAccess,
                        writeAccess: item.writeAccess,
                        ownerScoped: item.ownerScoped,
                        fields,
                        actions: item.actions ?? [],
                        migrations,
                      },
                    ).then((saved) => {
                      if (saved)
                        setMigrationDrafts((drafts) => ({
                          ...drafts,
                          [item.name]: '',
                        }));
                    });
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : 'Enter a valid JSON array.',
                    );
                  }
                }}
              >
                Save collection fields
              </Button>
              <label>
                Workflow actions (JSON)
                <textarea
                  rows={4}
                  aria-label={item.name + ' workflow actions'}
                  value={
                    workflowDrafts[item.name] ??
                    JSON.stringify(item.actions ?? [], null, 2)
                  }
                  onChange={(event) =>
                    setWorkflowDrafts((drafts) => ({
                      ...drafts,
                      [item.name]: event.target.value,
                    }))
                  }
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={readOnly}
                onClick={() => {
                  try {
                    const actions: unknown = JSON.parse(
                      workflowDrafts[item.name] ??
                        JSON.stringify(item.actions ?? []),
                    );
                    if (!Array.isArray(actions))
                      throw new Error('Actions must be a JSON array.');
                    void mutate(
                      endpoint +
                        '/collections/' +
                        encodeURIComponent(item.name),
                      {
                        readAccess: item.readAccess,
                        writeAccess: item.writeAccess,
                        ownerScoped: item.ownerScoped,
                        fields: item.fields,
                        actions,
                      },
                    );
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : 'Enter a valid JSON array.',
                    );
                  }
                }}
              >
                Save workflow actions
              </Button>
              <label>
                Read access{' '}
                <select
                  value={item.readAccess}
                  disabled={readOnly}
                  onChange={(event) =>
                    void mutate(
                      endpoint +
                        '/collections/' +
                        encodeURIComponent(item.name),
                      { ...item, readAccess: event.target.value },
                    )
                  }
                >
                  {accessOptions.map((option) => (
                    <option
                      key={option.value}
                      disabled={item.ownerScoped && option.value === 'public'}
                    >
                      {option.value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Write access{' '}
                <select
                  value={item.writeAccess}
                  disabled={readOnly}
                  onChange={(event) =>
                    void mutate(
                      endpoint +
                        '/collections/' +
                        encodeURIComponent(item.name),
                      { ...item, writeAccess: event.target.value },
                    )
                  }
                >
                  {accessOptions.map((option) => (
                    <option
                      key={option.value}
                      disabled={item.ownerScoped && option.value === 'public'}
                    >
                      {option.value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={item.ownerScoped}
                  disabled={readOnly}
                  onChange={(event) => {
                    const ownerScoped = event.target.checked;
                    void mutate(
                      endpoint +
                        '/collections/' +
                        encodeURIComponent(item.name),
                      {
                        ...item,
                        ownerScoped,
                        readAccess:
                          ownerScoped && item.readAccess === 'public'
                            ? 'authenticated'
                            : item.readAccess,
                        writeAccess:
                          ownerScoped && item.writeAccess === 'public'
                            ? 'authenticated'
                            : item.writeAccess,
                      },
                    );
                  }}
                />{' '}
                Keep each signed-in user's records private
              </label>
            </div>
          ))}
        </>
      )}
      {section === 'Logs' && (
        <>
          {activity.isError && (
            <p role="alert">{errorMessage(activity.error)}</p>
          )}
          {activity.isPending && <p role="status">Loading activity…</p>}
          {activity.isSuccess && activity.data.activity.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Workspace member</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.data.activity.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.createdAt).toLocaleString()}</td>
                      <td>{event.action.replaceAll('.', ' ')}</td>
                      <td>
                        <code>{event.targetId.slice(0, 12)}</code>
                      </td>
                      <td>
                        <code>{event.actorId.slice(0, 8)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : activity.isSuccess ? (
            <EmptyState
              title="No activity yet"
              description="App data, collection access, and user role changes will appear here."
            />
          ) : null}
          {activity.isSuccess && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={activityPages.length === 1 || activity.isFetching}
                onClick={() => setActivityPages(activityPages.slice(0, -1))}
              >
                Previous
              </Button>
              <span>Page {activityPages.length}</span>
              <Button
                variant="secondary"
                disabled={!activity.data.next || activity.isFetching}
                onClick={() =>
                  activity.data.next &&
                  setActivityPages([...activityPages, activity.data.next])
                }
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
      {section === 'Analytics' && (
        <>
          {analytics.isError && (
            <p role="alert">{errorMessage(analytics.error)}</p>
          )}
          {analytics.isPending && <p role="status">Loading analytics…</p>}
          {analytics.isSuccess && (
            <>
              <dl className={styles.metrics}>
                <div>
                  <dt>Records</dt>
                  <dd>{analytics.data.analytics.recordCount}</dd>
                </div>
                <div>
                  <dt>App users</dt>
                  <dd>{analytics.data.analytics.userCount}</dd>
                </div>
                <div>
                  <dt>Stored files</dt>
                  <dd>{analytics.data.analytics.fileCount}</dd>
                </div>
                <div>
                  <dt>Live storage used</dt>
                  <dd>
                    {BigInt(
                      analytics.data.analytics.storageBytes,
                    ).toLocaleString()}{' '}
                    bytes
                  </dd>
                </div>
                <div>
                  <dt>Storage credits</dt>
                  <dd>
                    {Number(analytics.data.analytics.storageCredits).toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt>Collections</dt>
                  <dd>{analytics.data.analytics.collectionCount}</dd>
                </div>
                <div>
                  <dt>Changes in the last 7 days</dt>
                  <dd>{analytics.data.analytics.activityLast7Days}</dd>
                </div>
                <div>
                  <dt>Model credits</dt>
                  <dd>{analytics.data.analytics.modelCredits.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Tool credits</dt>
                  <dd>{analytics.data.analytics.toolCredits.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Total build credits</dt>
                  <dd>{analytics.data.analytics.totalCredits.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Charged media jobs</dt>
                  <dd>{analytics.data.analytics.mediaJobs}</dd>
                </div>
                <div>
                  <dt>Media credits</dt>
                  <dd>
                    {Number(analytics.data.analytics.mediaCredits).toFixed(2)}
                  </dd>
                </div>
              </dl>
              <p>
                Live storage shows the bytes currently held by this app’s files.{' '}
                Storage credits use a rate of{' '}
                {analytics.data.analytics.storageCreditsPerMib} Foundable
                credits per MiB; zero disables charges. Deleting a file refunds
                its upload charge. Build credits come from completed model and
                tool charges associated with this app’s revisions. Media credits
                use configured Foundable rates, not provider invoice amounts.
              </p>
            </>
          )}
        </>
      )}
      {section === 'Code' && !readOnly && (
        <>
          {source.isError && <p role="alert">{errorMessage(source.error)}</p>}
          {source.isPending && <p role="status">Loading generated source…</p>}
          {source.isSuccess && !source.data.source && (
            <EmptyState
              title="No source revision yet"
              description="The first complete source revision will appear after the next app build."
            />
          )}
          {source.data?.source && (
            <>
              <p>
                Revision {source.data.source.revision} · isolated build{' '}
                {source.data.source.buildState}
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadSource(source.data.source!)}
              >
                Export source revision
              </Button>
              {source.data.github && (
                <>
                  <p>
                    GitHub · {source.data.github.repo} ·{' '}
                    {source.data.github.branch}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={syncingSource}
                    onClick={() =>
                      void syncSourceRevision(source.data.source!.revision)
                    }
                  >
                    {syncingSource ? 'Syncing source…' : 'Sync source revision'}
                  </Button>
                  {sourceSync && (
                    <p role="status">
                      {sourceSync.changed
                        ? 'Source synced to GitHub.'
                        : 'GitHub source is up to date.'}{' '}
                      <a href={sourceSync.url} target="_blank" rel="noreferrer">
                        View commit
                      </a>
                    </p>
                  )}
                </>
              )}
              {source.data.source.buildState === 'failed' && (
                <pre role="alert">{source.data.source.buildLog}</pre>
              )}
              {source.data.source.sourceFiles.map((file) => (
                <details className={styles.sourceFile} key={file.path} open>
                  <summary>{file.path}</summary>
                  <pre>
                    <code>{file.content}</code>
                  </pre>
                </details>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
