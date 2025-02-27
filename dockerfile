# Usar la imagen base de Node.js
FROM node:20.18.0-slim

# Crear y establecer el directorio de trabajo
WORKDIR /app

# Copiar el package.json y package-lock.json
COPY package.json package-lock.json ./

# Instalar pnpm globalmente
RUN npm install -g pnpm

# Instalar las dependencias de la aplicación
RUN npm ci --include=dev

# Copiar el resto del código de la aplicación
COPY . .

# Ejecutar el build
RUN npm run build

# Exponer el puerto en el que tu API corre
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["npm", "start"]
