package com.example.droplets;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Droplets embedded from Spring Boot: the basic page on `/` ({@link IndexController}),
 * the shop demo's pages ({@link ShopPages}) and its same-origin proxy ({@link ShopProxy}).
 */
@SpringBootApplication
public class Application {

  public static void main(String[] args) {
    SpringApplication.run(Application.class, args);
  }

  /**
   * One client for every visitor, so it must never keep cookies or follow a
   * redirect: the JDK client has no cookie handler unless one is given, so a
   * cookie the shop sets on one visitor's answer never rides along with the
   * next visitor's request, and a droplet's 3xx comes back as it is.
   */
  static RestClient restClient(Duration timeout) {
    HttpClient http =
        HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
    factory.setReadTimeout(timeout);
    return RestClient.builder().requestFactory(factory).build();
  }

  @Bean
  RestClient restClient() {
    return restClient(Duration.ofSeconds(10));
  }

  /** A page's fragments are fetched at once, a virtual thread each. */
  @Bean(destroyMethod = "close")
  ExecutorService fragmentExecutor() {
    return Executors.newVirtualThreadPerTaskExecutor();
  }
}
