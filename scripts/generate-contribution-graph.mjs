import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import https from 'node:https';

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_REPOSITORY_OWNER;

if (!token || !login) {
  throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY_OWNER are required.');
}

const query = `query ContributionCalendar($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date weekday } }
      }
    }
  }
}`;

function postJson(url, body, headers) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = https.request(url, { method: 'POST', headers }, (response) => {
      let payload = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { payload += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          rejectRequest(new Error(`GitHub GraphQL returned ${response.statusCode}: ${payload}`));
          return;
        }
        try {
          resolveRequest(JSON.parse(payload));
        } catch (error) {
          rejectRequest(error);
        }
      });
    });
    request.on('error', rejectRequest);
    request.write(body);
    request.end();
  });
}

function colorFor(count, maximum) {
  if (count === 0) return '#142435';
  const ratio = maximum === 0 ? 0 : count / maximum;
  if (ratio < 0.18) return '#1e405c';
  if (ratio < 0.42) return '#28658a';
  if (ratio < 0.72) return '#3a91bc';
  return '#75cdec';
}

function renderSvg(calendar, owner) {
  const weeks = calendar.weeks.slice(-53);
  const days = weeks.flatMap((week) => week.contributionDays);
  const maximum = Math.max(0, ...days.map((day) => day.contributionCount));
  const square = 12;
  const gap = 5;
  const left = 139;
  const top = 111;
  const rows = ['Mon', 'Wed', 'Fri'];
  const labels = rows.map((label, index) => `<text x="48" y="${top + (index * 2 + 1) * (square + gap) - 2}">${label}</text>`).join('');
  const cells = weeks.flatMap((week, xIndex) => week.contributionDays.map((day) => {
    const x = left + xIndex * (square + gap);
    const y = top + day.weekday * (square + gap);
    const color = colorFor(day.contributionCount, maximum);
    return `<rect x="${x}" y="${y}" width="${square}" height="${square}" rx="2" fill="${color}"><title>${day.date}: ${day.contributionCount} contribution${day.contributionCount === 1 ? '' : 's'}</title></rect>`;
  })).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="310" viewBox="0 0 1100 310" role="img" aria-labelledby="title description">
  <title id="title">Public GitHub contribution field for ${owner}</title>
  <desc id="description">${calendar.totalContributions} public GitHub contributions during the displayed year.</desc>
  <defs><linearGradient id="backdrop" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#091522"/><stop offset="1" stop-color="#0d1b2d"/></linearGradient></defs>
  <rect width="1100" height="310" rx="16" fill="url(#backdrop)"/>
  <text x="48" y="57" fill="#9ad8f2" font-family="Inter, Geist, Arial, sans-serif" font-size="14" letter-spacing="2.5">CONTRIBUTION FIELD</text>
  <text x="48" y="88" fill="#718c9f" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12">PUBLIC GITHUB TELEMETRY / ${owner.toUpperCase()}</text>
  <g fill="#6f8b9f" font-family="Inter, Geist, Arial, sans-serif" font-size="11">${labels}</g>
  <g>${cells}</g>
  <path d="M48 258H1052" stroke="#6dbadd" stroke-opacity=".27"/>
  <text x="48" y="284" fill="#b5c7d2" font-family="Inter, Geist, Arial, sans-serif" font-size="13">${calendar.totalContributions} public contributions in the observed year</text>
  <text x="1052" y="284" text-anchor="end" fill="#718c9f" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11">REFRESHED BY GITHUB ACTIONS</text>
</svg>`;
}

const response = await postJson('https://api.github.com/graphql', JSON.stringify({ query, variables: { login } }), {
  Authorization: `bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'profile-contribution-signal',
});

if (response.errors?.length) throw new Error(response.errors.map((error) => error.message).join('; '));
const user = response.data?.user;
const calendar = user?.contributionsCollection?.contributionCalendar;
if (!calendar) throw new Error(`No public contribution calendar found for ${login}.`);

const output = resolve('assets/contributions.svg');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, renderSvg(calendar, login), 'utf8');
