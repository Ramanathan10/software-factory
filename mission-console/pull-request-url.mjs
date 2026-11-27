const githubPath = /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)(?:\/.*)?$/;
const devPath = /^(\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/([1-9]\d*))(?:\/.*)?$/;
const legacyPath = /^((?:\/DefaultCollection)?\/([^/]+)\/_git\/([^/]+)\/pullrequest\/([1-9]\d*))(?:\/.*)?$/;
const legacySuffix = '.visualstudio.com';
const decoded = segment => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

function azure({ origin, hostname, host, pathname }) {
  const dev = hostname === 'dev.azure.com';
  const found = (dev ? devPath : legacyPath).exec(pathname);
  if (!found) return dev ? { kind: 'not-a-pr' } : null;
  const [, path, ...names] = found;
  const [org, project, repo, id] = dev ? names : [hostname.slice(0, -legacySuffix.length), ...names];
  return {
    kind: 'azure-devops', host, org, id, canonical: origin + path,
    key: ('azure:' + org + '/' + decoded(project) + '/' + decoded(repo) + '/' + id).toLowerCase(),
  };
}

export function pullRequestUrl(url) {
  const parsed = typeof url === 'string' ? URL.parse(url) : null;
  if (parsed?.protocol !== 'https:' || parsed.username || parsed.password) return null;
  if (parsed.hostname === 'dev.azure.com' || parsed.hostname.endsWith(legacySuffix)) return azure(parsed);
  const found = githubPath.exec(parsed.pathname);
  if (found) {
    const canonical = parsed.origin + '/' + found[1] + '/' + found[2] + '/pull/' + found[3];
    return { kind: 'github', host: parsed.host, canonical, key: canonical.toLowerCase() };
  }
  return parsed.hostname === 'github.com' ? { kind: 'not-a-pr' } : null;
}
