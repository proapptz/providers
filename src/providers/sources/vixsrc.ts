import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';

const baseUrl = 'https://vixsrc.to';
const pageProxy = 'https://proxy.proapptz.workers.dev/?destination=';
const streamProxy = 'https://proxy.proapptz.workers.dev/m3u8-proxy';

async function scrapeVixsrc(
  ctx: ShowScrapeContext | MovieScrapeContext
): Promise<SourcererOutput> {
  if (!ctx.media.tmdbId) {
    throw new Error('VixSrc requires TMDB id');
  }

  // -----------------------------------
  // 1. Build original VixSrc page URL
  // -----------------------------------

  const originalUrl =
    ctx.media.type === 'movie'
      ? `${baseUrl}/${ctx.media.tmdbId}`
      : `${baseUrl}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;

  // -----------------------------------
  // 2. Wrap with page proxy
  // -----------------------------------

  const proxiedPageUrl = `${pageProxy}${encodeURIComponent(originalUrl)}`;

  const response = await ctx.fetch(proxiedPageUrl);
  const html = await response.text();

  // -----------------------------------
  // 3. Extract window.masterPlaylist
  // -----------------------------------

  const match = html.match(
    /window\.masterPlaylist\s*=\s*({[\s\S]*?});/
  );

  if (!match) {
    throw new Error('VixSrc: masterPlaylist not found');
  }

  const jsonSafe = match[1]
    .replace(/(\w+):/g, '"$1":')
    .replace(/'/g, '"');

  let playlistData: any;

  try {
    playlistData = JSON.parse(jsonSafe);
  } catch {
    throw new Error('VixSrc: Failed to parse playlist JSON');
  }

  const { url, params } = playlistData;

  if (!url || !params?.token || !params?.expires) {
    throw new Error('VixSrc: Invalid playlist data');
  }

  // -----------------------------------
  // 4. Construct final HLS URL
  // -----------------------------------

  const hlsUrl = `${url}?token=${params.token}&expires=${params.expires}&h=1&lang=en`;

  // -----------------------------------
  // 5. Wrap HLS with stream proxy (for headers)
  // -----------------------------------

  const encodedStreamUrl = encodeURIComponent(hlsUrl);

  const encodedHeaders = encodeURIComponent(
    JSON.stringify({
      Origin: baseUrl,
      Referer: baseUrl + '/',
    })
  );

  const finalStreamUrl = `${streamProxy}?url=${encodedStreamUrl}&headers=${encodedHeaders}`;

  // -----------------------------------
  // 6. Return stream
  // -----------------------------------

  return {
    stream: {
      id: 'primary',
      type: 'hls',
      url: finalStreamUrl,
    },
  };
}

export const vixsrcSourceScraper = makeSourcerer({
  id: 'vixsrcSource',
  name: 'Main',
  rank: 5,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: scrapeVixsrc,
  scrapeShow: scrapeVixsrc,
});
