# The Go toolchain builds and tests; the image that runs holds the binary alone.
FROM golang:1.27-alpine AS build
ENV CGO_ENABLED=0
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY templates templates
COPY static static
RUN go vet ./... && go test ./... && go build -trimpath -ldflags="-s -w" -o /host .

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /host /host
EXPOSE 8017
ENTRYPOINT ["/host"]
