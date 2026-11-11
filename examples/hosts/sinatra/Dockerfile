FROM ruby:3.3-slim
WORKDIR /app
COPY Gemfile ./
RUN bundle install
COPY . .
EXPOSE 8002
CMD ["bundle", "exec", "ruby", "app.rb"]
