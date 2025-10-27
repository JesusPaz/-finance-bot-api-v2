FROM amazonlinux:2

# Instalar dependencias necesarias
RUN yum update -y && \
    yum install -y gcc-c++ make autoconf automake libtool wget tar gzip zlib-devel libjpeg-turbo-devel zip

# Crear directorio de trabajo
WORKDIR /tmp

# Descargar y compilar qpdf
RUN wget https://github.com/qpdf/qpdf/releases/download/release-qpdf-10.6.3/qpdf-10.6.3.tar.gz && \
    tar -xzf qpdf-10.6.3.tar.gz && \
    cd qpdf-10.6.3 && \
    ./configure --prefix=/opt && \
    make -j$(nproc) && \
    make install

# Crear el archivo ZIP para el layer
WORKDIR /opt
RUN zip -r /qpdf-layer.zip .

# Copiar el archivo ZIP al directorio de salida
CMD ["cp", "/qpdf-layer.zip", "/out/"]