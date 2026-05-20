FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_API_URL=http://localhost:8000
ARG VITE_RAG_URL=http://localhost:8004
ARG VITE_MINIO_URL=http://localhost:9000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_RAG_URL=$VITE_RAG_URL
ENV VITE_MINIO_URL=$VITE_MINIO_URL

COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
