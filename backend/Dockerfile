FROM node:21.4.0-bookworm

WORKDIR /usr/src/app/backend/

COPY package*.json ./
COPY jailbreak-pool/Anchor.toml ./
COPY jailbreak-pool/target ./target

# pull the aws documentdb cert and pipeline binary
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem ./aws-global-bundle.pem
ADD https://github.com/viralmind-ai/vm-pipeline/releases/latest/download/pipeline-linux-x64 ./pipeline
RUN chmod +x pipeline

# Install dependencies including guacamole build requirements
RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  build-essential \
  python3 \
  ffmpeg \
  autoconf \
  libtool \
  libcairo2-dev \
  libjpeg62-turbo-dev \
  libpng-dev \
  libossp-uuid-dev \
  libavcodec-dev \
  libavformat-dev \
  libavutil-dev \
  libswscale-dev \
  freerdp2-dev \
  libpango1.0-dev \
  libssh2-1-dev \
  libtelnet-dev \
  libvncserver-dev \
  libwebsockets-dev \
  libpulse-dev \
  libssl-dev \
  libvorbis-dev \
  libwebp-dev \
  git && \
  git clone https://github.com/apache/guacamole-server.git && \
  cd guacamole-server && \
  autoreconf -fi && \
  ./configure --with-init-dir=/etc/init.d && \
  make && \
  make install && \
  ldconfig && \
  cd .. && \
  rm -rf guacamole-server && \
  apt-get remove -y git autoconf libtool && \
  apt-get autoremove -y && \
  rm -rf /var/lib/apt/lists/*

RUN npm ci
RUN npm install --cpu=x64 --os=linux --libc=glibc sharp
RUN npm install --global tsx

COPY . .

RUN npm run build

EXPOSE 8001
