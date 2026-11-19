FROM ruby:4.0-slim AS base
WORKDIR /app
ENV RAILS_ENV=production

# Puma and some of Rails' gems compile native extensions.
FROM base AS build
RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y build-essential libyaml-dev \
  && rm -rf /var/lib/apt/lists/*
COPY Gemfile ./
RUN bundle install
COPY . .
# The host's own tests (test/): a failing one fails the image.
RUN RAILS_ENV=test bin/rails test

FROM base
COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build /app /app
EXPOSE 8015
CMD ["bundle", "exec", "puma", "-C", "config/puma.rb"]
