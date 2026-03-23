# UCS Realtime Push Service Dockerfile
FROM eclipse-temurin:17-jre-alpine
LABEL maintainer="UCS Team"

WORKDIR /app
COPY target/*.jar app.jar

EXPOSE 8083

ENTRYPOINT ["java", "-jar", "app.jar"]
