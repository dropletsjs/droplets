ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

class ActionDispatch::IntegrationTest
  # The shop, answering every request with `answer` (called with the
  # request's method, target, headers and body), for the block; the block
  # gets the requests it saw.
  def with_shop(answer)
    seen = []
    original = Shop.method(:request)
    Shop.define_singleton_method(:request) do |method, target, headers, body = nil|
      seen << { method: method, target: target, headers: headers, body: body }
      answer.call(method, target, headers, body)
    end
    yield seen
  ensure
    Shop.define_singleton_method(:request, original)
  end

  # An answer as Net::HTTP returns it.
  def shop_answer(status, headers = {}, body = "")
    answer = Net::HTTPResponse::CODE_TO_OBJ.fetch(status.to_s).new("1.1", status.to_s, "")
    headers.each { |name, value| Array(value).each { |one| answer.add_field(name, one) } }
    answer.instance_variable_set(:@body, body.dup)
    answer.instance_variable_set(:@read, true)
    answer
  end
end
