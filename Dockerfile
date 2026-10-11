# The demo as one image: the page built once, served by the API.
FROM node:22-alpine AS web
WORKDIR /srv/app
COPY frontend/package.json ./
RUN npm install
COPY frontend .
RUN npm run build

FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app app
COPY --from=web /srv/app/dist /srv/static
ENV STATIC_DIR=/srv/static
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
