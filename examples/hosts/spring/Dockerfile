FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src src
# `package` runs the tests (src/test) first: a failing one stops the build.
RUN mvn -B -q package

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /app/target/app.jar app.jar
USER 1000
EXPOSE 8016
CMD ["java", "-jar", "app.jar"]
