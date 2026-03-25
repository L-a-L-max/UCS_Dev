# UCS API Gateway Dockerfile
# 使用方式: 先在 ucs-platform 根目录执行 mvn clean package -DskipTests，再 docker compose up
FROM eclipse-temurin:17-jre-alpine
LABEL maintainer="UCS Team"

WORKDIR /app
COPY target/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
