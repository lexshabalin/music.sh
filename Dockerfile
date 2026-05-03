# Frontend -> cmd/server/dist
FROM node:20-alpine AS web
# Cap Node heap and npm parallelism so multi-stage builds don’t overwhelm small VM/hypervisor hosts during `docker compose build`.
ENV NODE_OPTIONS=--max-old-space-size=768
ENV npm_config_jobs=2
WORKDIR /app
COPY web ./web
WORKDIR /app/web
RUN npm install --no-audit
RUN npm run build

# Go binary
FROM golang:1.22-alpine AS gob
ENV GOMAXPROCS=2
RUN apk add --no-cache ca-certificates git
WORKDIR /src
COPY go.mod go.sum* ./
COPY . .
COPY --from=web /app/cmd/server/dist ./cmd/server/dist
RUN go mod tidy && CGO_ENABLED=0 go build -o /out/musicsh ./cmd/server

FROM alpine:3.19
# Runtime deps:
# - chromaprint provides fpcalc (AcoustID fingerprint)
# - ffmpeg provides ffprobe (duration probing)
# util-linux: ionice for low-priority ffprobe/fpcalc/ffmpeg (see internal/subproclow).
RUN apk add --no-cache ca-certificates tzdata chromaprint ffmpeg util-linux
WORKDIR /app
COPY --from=gob /out/musicsh /app/musicsh
ENV HTTP_ADDR=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["/app/musicsh"]
