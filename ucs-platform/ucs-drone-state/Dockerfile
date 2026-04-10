# UCS Drone State Service Dockerfile
FROM eclipse-temurin:17-jre-alpine
LABEL maintainer="UCS Team"

WORKDIR /app
COPY target/*.jar app.jar

EXPOSE 8085

ENTRYPOINT ["java", "-jar", "app.jar"]
