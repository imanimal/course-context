# course-context server: HTTP API, MCP at /mcp, sync on a timer. Data in /data.
# docker run -p 8787:8787 -v course-context:/data -e COURSE_CONTEXT_TOKEN=... -e COURSE_CONTEXT_SYNC_EVERY=30 course-context
FROM node:22-alpine
WORKDIR /app
COPY package.json LICENSE README.md llms.txt llms-install.md AGENTS.md ./
COPY src ./src
COPY docs ./docs
COPY schema ./schema
COPY skills ./skills
RUN ln -s /app/src/cli.js /usr/local/bin/course-context && chmod +x /app/src/cli.js && mkdir -p /data && chown node:node /data
USER node
ENV COURSE_CONTEXT_HOME=/data PORT=8787 NODE_ENV=production
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "/app/src/cli.js", "serve", "--host", "0.0.0.0", "--text"]
