# Frontend -> cmd/server/dist
FROM node:20-alpine AS web
WORKDIR /app
COPY web ./web
WORKDIR /app/web
RUN npm install --no-audit
RUN npm run build

# Go binary
FROM golang:1.22-alpine AS gob
RUN apk add --no-cache ca-certificates git
WORKDIR /src
COPY go.mod go.sum* ./
COPY . .
COPY --from=web /app/cmd/server/dist ./cmd/server/dist
RUN go mod tidy && CGO_ENABLED=0 go build -o /out/musicsh ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=gob /out/musicsh /app/musicsh
ENV HTTP_ADDR=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["/app/musicsh"]
