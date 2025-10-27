#!/bin/bash

# Script para crear un layer simple de qpdf usando el binario local
set -e

echo "🔧 Creando Layer simple de qpdf con binario local"
echo "================================================="

LAYER_DIR="qpdf-simple-layer"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

echo "📁 Creando estructura del layer..."

# Crear directorios
mkdir -p $LAYER_DIR/opt/bin

# Copiar el binario de qpdf local (que sabemos que funciona)
echo "📋 Copiando binario de qpdf local..."
cp /opt/homebrew/bin/qpdf $LAYER_DIR/opt/bin/qpdf 2>/dev/null || {
    echo "❌ No se encontró qpdf en /opt/homebrew/bin/qpdf"
    echo "🔍 Buscando qpdf en el sistema..."
    
    # Buscar qpdf en el sistema
    QPDF_PATH=$(which qpdf 2>/dev/null || echo "")
    if [ -n "$QPDF_PATH" ]; then
        echo "✅ Encontrado qpdf en: $QPDF_PATH"
        cp "$QPDF_PATH" $LAYER_DIR/opt/bin/qpdf
    else
        echo "❌ No se encontró qpdf en el sistema"
        echo "💡 Instalando qpdf con homebrew..."
        brew install qpdf
        cp /opt/homebrew/bin/qpdf $LAYER_DIR/opt/bin/qpdf
    fi
}

# Verificar que el binario funciona
echo "🧪 Verificando binario..."
chmod +x $LAYER_DIR/opt/bin/qpdf
$LAYER_DIR/opt/bin/qpdf --version

# Crear script de prueba
cat > $LAYER_DIR/test-qpdf.sh << 'EOF'
#!/bin/bash
echo "🧪 Probando qpdf en el layer..."
/opt/bin/qpdf --version
echo "✅ Layer funcionando correctamente"
EOF

chmod +x $LAYER_DIR/test-qpdf.sh

# Crear README
cat > $LAYER_DIR/README.md << 'EOF'
# qpdf Lambda Layer

Este layer proporciona qpdf para AWS Lambda.

## Uso

```javascript
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Usar qpdf
const { stdout } = await execAsync('/opt/bin/qpdf --version');
```

## Comandos comunes

- `qpdf --version` - Ver versión
- `qpdf --password=PASS --decrypt input.pdf output.pdf` - Desbloquear PDF
- `qpdf --check input.pdf` - Verificar PDF
EOF

# Crear ZIP
echo "📦 Creando ZIP del layer..."
cd $LAYER_DIR
zip -r ../qpdf-simple-layer.zip . > /dev/null
cd ..

echo "✅ Layer creado: qpdf-simple-layer.zip"
echo "📊 Tamaño: $(du -h qpdf-simple-layer.zip | cut -f1)"

# Limpiar
rm -rf $LAYER_DIR

echo ""
echo "🎉 Layer simple con qpdf listo!"
echo ""
echo "📋 Para publicar:"
echo "aws lambda publish-layer-version \\"
echo "  --layer-name qpdf-simple \\"
echo "  --zip-file fileb://qpdf-simple-layer.zip \\"
echo "  --compatible-runtimes nodejs22.x \\"
echo "  --description 'Simple qpdf for PDF processing'"
