# Build stage
FROM golang:1.22-alpine AS builder

# Install git and ca-certificates (needed for fetching dependencies)
RUN apk add --no-cache git ca-certificates tzdata

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o pcl-api ./cmd/server

# Final stage
FROM alpine:3.19

# Install ca-certificates for HTTPS and tzdata for timezones.
# python3 + paramiko + psycopg2 are included so the LOCAL-DEV "Equalize Reports"
# endpoint can run backend/scripts/equalize_reports.py inside the container.
# (Production uses deploy/Dockerfile, which does NOT include any of this.)
RUN apk --no-cache add ca-certificates tzdata python3 py3-paramiko py3-psycopg2

# Create non-root user
RUN addgroup -g 1000 pcl && \
    adduser -u 1000 -G pcl -s /bin/sh -D pcl

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/pcl-api .

# Copy migrations
COPY --from=builder /app/migrations ./migrations

# Copy service-account credentials for Google Sheets (Social Media Analysis)
COPY --from=builder /app/credentials ./credentials

# Copy local-dev scripts (Equalize Reports). Harmless in prod (separate Dockerfile).
COPY --from=builder /app/scripts ./scripts

# Create upload directory
RUN mkdir -p /var/reports && chown -R pcl:pcl /var/reports

# Set ownership
RUN chown -R pcl:pcl /app

# Switch to non-root user
USER pcl

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the application
CMD ["./pcl-api"]
