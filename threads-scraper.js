// Threads.net scraper — uses session cookies from a logged-in account.
//
// HOW TO GET COOKIES:
//   1. Open threads.net in your browser, logged in
//   2. DevTools → Application → Cookies → https://www.threads.net
//   3. Copy values for `sessionid` and `csrftoken`
//   4. Set X_THREADS_SESSION and X_THREADS_CSRF in habit-api/.env (on the server)
//
// DOC ID:
//   If scraping breaks, open threads.net, go to a profile, inspect Network tab,
//   filter by "graphql", find the UserThreads request, copy the new doc_id.

const KARPATHY_USERNAME = 'karpathy';
const THREADS_APP_ID = '238260118697367';
const USER_THREADS_DOC_ID = '6232751443445612';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Cached per-session config (lsd token + user ID)
let threadsConfig = null;

async function getThreadsConfig() {
  if (threadsConfig) return threadsConfig;

  const res = await fetch(`https://www.threads.com/@${KARPATHY_USERNAME}`, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) throw new Error(`Threads profile page returned ${res.status}`);
  const html = await res.text();

  const lsdMatch = html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/);
  if (!lsdMatch) throw new Error('Could not find LSD token in Threads page');

  // User ID appears in multiple patterns across page versions
  const userIdMatch =
    html.match(/"user_id":"(\d+)"/) ||
    html.match(/"pk":"(\d{10,})"/) ||
    html.match(/userID["\s:]+(\d{10,})/);
  if (!userIdMatch) throw new Error('Could not find user ID in Threads page');

  threadsConfig = { lsd: lsdMatch[1], userId: userIdMatch[1] };
  return threadsConfig;
}

async function fetchKarpathyThreads(sessionId, csrfToken) {
  const { lsd, userId } = await getThreadsConfig();

  const res = await fetch('https://www.threads.net/api/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-fb-lsd': lsd,
      'x-csrftoken': csrfToken,
      'x-ig-app-id': THREADS_APP_ID,
      cookie: `sessionid=${sessionId}; csrftoken=${csrfToken}`,
      'user-agent': UA,
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      referer: `https://www.threads.net/@${KARPATHY_USERNAME}`,
    },
    body: new URLSearchParams({
      lsd,
      variables: JSON.stringify({ userID: userId }),
      doc_id: USER_THREADS_DOC_ID,
    }),
  });

  if (!res.ok) {
    if (res.status === 401) threadsConfig = null;
    const body = await res.text().catch(() => '');
    throw new Error(`Threads returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return parseThreads(data);
}

function parseThreads(data) {
  const edges =
    data?.data?.userData?.user?.threads?.edges ??
    data?.data?.mediaData?.threads ??
    [];

  const posts = [];

  for (const edge of edges) {
    const thread = edge?.node ?? edge;
    const items = thread?.thread_items ?? [];

    // First item in a thread is the root post
    const root = items[0]?.post;
    if (!root) continue;

    const caption = root.caption?.text ?? '';
    const id = root.pk ?? root.id;
    const takenAt = root.taken_at; // unix timestamp

    posts.push({
      id: String(id),
      text: caption,
      date: takenAt ? new Date(takenAt * 1000).toISOString() : '',
      link: `https://www.threads.net/@${KARPATHY_USERNAME}/post/${root.code ?? id}`,
      likes: root.like_count ?? 0,
      replyCount: root.text_post_app_info?.reply_count ?? 0,
    });
  }

  return posts;
}

module.exports = { fetchKarpathyThreads };
