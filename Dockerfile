FROM --platform=linux/amd64 public.ecr.aws/lambda/nodejs:22

# Instalar unzip y poppler-utils (para pdftotext)
RUN dnf install -y unzip poppler-utils && \
    dnf clean all

# Descargar binario oficial de qpdf para Lambda
RUN QPDF_VERSION="11.6.3" && \
    curl -L "https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/qpdf-${QPDF_VERSION}-bin-linux-x86_64.zip" -o qpdf-layer.zip && \
    unzip qpdf-layer.zip && \
    cp -r bin/* /usr/local/bin/ && \
    cp -r lib/* /usr/local/lib/ && \
    rm -rf qpdf-layer.zip bin lib

# Copiar código de la aplicación
COPY lambda/ ${LAMBDA_TASK_ROOT}/

# Instalar dependencias de Node.js
RUN npm install

# Configurar el handler
CMD ["workers/pdf-processor.handler"]
