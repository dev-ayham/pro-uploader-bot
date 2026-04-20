FROM node:22-slim AS base

# yt-dlp + ffmpeg let us download from Instagram / YouTube / TikTok / Twitter /
# Facebook / Reddit / ... in addition to plain direct HTTP URLs.
#
# The yt-dlp release in Debian's apt repo is often months behind, which breaks
# Instagram / TikTok extractors as they update their sites. Pull the official
# self-contained zipapp straight from the latest GitHub release instead.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
        python3 \
        curl \
    && curl -fsSL -o /usr/local/bin/yt-dlp \
        https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies for the runtime image
RUN npm prune --omit=dev

ENV NODE_ENV=production

# Runtime env vars (set in Railway → Variables):
#   TELEGRAM_BOT_TOKEN, API_ID, API_HASH  (required)
#   YT_DLP_COOKIES                        (optional: Netscape cookies.txt for
#                                          Instagram/YouTube auth-walled URLs)
#   OPENAI_API_KEY                        (optional: enables the AI intent
#                                          parser fallback — "give me the
#                                          audio" etc. Falls back silently
#                                          to the regex classifier if unset.)
#   OPENAI_MODEL                          (optional, default "gpt-4o-mini")
#   AI_DAILY_LIMIT_PER_USER               (optional, default 20 OpenAI calls
#                                          per chat per UTC day)
CMD ["node", "dist/index.js"]
