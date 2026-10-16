export type AppMetadata = {
  appVersion: string;
  buildNumber: string | null;
  commitSha: string | null;
  buildDate: string | null;
  isPublished: boolean;
};

export type AppMetadataInput = {
  appVersion: string;
  buildNumber?: string;
  commitSha?: string;
  buildDate?: string;
};

function textOrNull(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isSemVer(value: string | null): value is string {
  return Boolean(value && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value));
}

function isCommitSha(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{7,40}$/i.test(value));
}

function isIsoDate(value: string | null): value is string {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

export function createAppMetadata(input: AppMetadataInput): AppMetadata {
  const requestedVersion = textOrNull(input.appVersion);
  const appVersion = isSemVer(requestedVersion) ? requestedVersion : '0.0.0';
  const buildNumber = textOrNull(input.buildNumber);
  const commitSha = textOrNull(input.commitSha);
  const buildDate = textOrNull(input.buildDate);
  const isPublished = Boolean(buildNumber && isCommitSha(commitSha) && isIsoDate(buildDate));

  return {
    appVersion,
    buildNumber: isPublished ? buildNumber : null,
    commitSha: isPublished ? commitSha : null,
    buildDate: isPublished ? buildDate : null,
    isPublished,
  };
}

export function formatBuildDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export const appMetadata = createAppMetadata({
  appVersion: typeof __FLUX_APP_VERSION__ === 'string' ? __FLUX_APP_VERSION__ : '0.0.0',
  buildNumber: typeof __FLUX_BUILD_NUMBER__ === 'string' ? __FLUX_BUILD_NUMBER__ : undefined,
  commitSha: typeof __FLUX_COMMIT_SHA__ === 'string' ? __FLUX_COMMIT_SHA__ : undefined,
  buildDate: typeof __FLUX_BUILD_DATE__ === 'string' ? __FLUX_BUILD_DATE__ : undefined,
});
