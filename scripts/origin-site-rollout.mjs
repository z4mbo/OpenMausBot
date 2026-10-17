export const quoteShellWord = arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;

const requireAbsent = (path, message) => `if [ -e ${quoteShellWord(path)} ] || [ -L ${quoteShellWord(path)} ]; then echo ${quoteShellWord(message)} >&2; exit 1; fi`;

export function siteRolloutScript({ site, compose, tarball, releaseId }) {
  const quote = quoteShellWord;
  const stage = `${site}.new-${releaseId}`;
  const backup = `${site}.bak-${releaseId}`;
  const operator = `${site}/deploy`;
  const stagedOperator = `${stage}/deploy`;
  return [
    "set -eu",
    requireAbsent(backup, "Rollout backup already exists"),
    `mkdir -- ${quote(stage)}`,
    `tar -xzf ${quote(tarball)} -C ${quote(stage)}`,
    `if [ -e ${quote(operator)} ] || [ -L ${quote(operator)} ]; then`,
    `  ${requireAbsent(stagedOperator, "Incoming operator configuration conflicts with the existing deployment")}`,
    `  cp -a -- ${quote(operator)} ${quote(stagedOperator)}`,
    "fi",
    `if [ -e ${quote(site)} ] || [ -L ${quote(site)} ]; then`,
    `  ${requireAbsent(backup, "Rollout backup appeared before the site could move")}`,
    `  mv -- ${quote(site)} ${quote(backup)}`,
    "fi",
    requireAbsent(site, "Site path appeared before the staged tree could move"),
    `mv -- ${quote(stage)} ${quote(site)}`,
    `rm -f -- ${quote(tarball)}`,
    `cd ${quote(compose)} && docker compose up -d --no-deps --build origin`,
  ].join("\n");
}
