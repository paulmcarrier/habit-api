// Twitter/X internal GraphQL scraper
// Uses browser session cookies — no paid API needed.
//
// HOW TO GET COOKIES:
//   1. Open x.com in your browser, logged in
//   2. DevTools → Application → Cookies → https://x.com
//   3. Copy values for `auth_token` and `ct0`
//   4. Set X_AUTH_TOKEN and X_CT0 in habit-api/.env (on the server)
//
// QUERY ID:
//   If scraping breaks with 400/404, open x.com, go to a profile, inspect
//   Network tab, filter by "UserTweets", copy the new query ID from the URL.

const { randomUUID } = require('crypto');

const KARPATHY_USER_ID = '33836629';
const USER_TWEETS_QUERY_ID = 'V1ze5q3ijDS1VeLwLY0m7g';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Bearer token cache — fetched dynamically from Twitter's JS bundle
let cachedBearerToken = null;

async function getBearerToken() {
  if (cachedBearerToken) return cachedBearerToken;

  // Fetch x.com homepage to find the main JS bundle URL
  const pageRes = await fetch('https://x.com/', {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
  });
  const html = await pageRes.text();

  // Find a JS bundle that's likely to contain the bearer token
  const scriptMatch = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[^"']+\.js/);
  if (!scriptMatch) throw new Error('Could not locate Twitter main JS bundle');

  const jsRes = await fetch(scriptMatch[0], { headers: { 'user-agent': UA } });
  const js = await jsRes.text();

  // Bearer tokens start with AAAA and are ~100 chars
  const tokenMatch = js.match(/["']?(AAAA[A-Za-z0-9%]{80,})["']?/);
  if (!tokenMatch) throw new Error('Could not extract bearer token from JS bundle');

  cachedBearerToken = tokenMatch[1];
  return cachedBearerToken;
}

const VARIABLES = {
  userId: KARPATHY_USER_ID,
  count: 20,
  includePromotedContent: false,
  withQuickPromoteEligibilityTweetFields: false,
  withVoice: false,
  withV2Timeline: true,
};

const FEATURES = {
  rweb_lists_timeline_redesign_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

async function fetchKarpathyTweets(authToken, ct0) {
  const bearerToken = await getBearerToken();

  const url =
    `https://x.com/i/api/graphql/${USER_TWEETS_QUERY_ID}/UserTweets` +
    `?variables=${encodeURIComponent(JSON.stringify(VARIABLES))}` +
    `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;

  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${bearerToken}`,
      cookie: `auth_token=${authToken}; ct0=${ct0}`,
      'x-csrf-token': ct0,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en',
      'x-client-uuid': randomUUID(),
      'user-agent': UA,
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      referer: 'https://x.com/karpathy',
    },
  });

  if (!res.ok) {
    // If 401, clear cached token so next attempt re-fetches it
    if (res.status === 401) cachedBearerToken = null;
    const body = await res.text().catch(() => '');
    throw new Error(`Twitter returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return parseTweets(data);
}

function parseTweets(data) {
  const instructions =
    data?.data?.user?.result?.timeline_v2?.timeline?.instructions ?? [];
  const tweets = [];

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue;
    for (const entry of instruction.entries ?? []) {
      if (entry.content?.entryType !== 'TimelineTimelineItem') continue;
      const result = entry.content?.itemContent?.tweet_results?.result;
      if (!result) continue;

      const tweetData = result.tweet ?? result;
      const legacy = tweetData?.legacy;
      if (!legacy) continue;
      if (legacy.retweeted_status_result) continue; // skip retweets

      tweets.push({
        id: legacy.id_str,
        text: legacy.full_text,
        date: legacy.created_at,
        link: `https://x.com/karpathy/status/${legacy.id_str}`,
        likes: legacy.favorite_count ?? 0,
        retweets: legacy.retweet_count ?? 0,
        isReply: !!legacy.in_reply_to_screen_name,
      });
    }
  }

  return tweets;
}

module.exports = { fetchKarpathyTweets };
