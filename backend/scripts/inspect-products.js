require('dotenv').config()
const {getProductsByArea} = require('../src/services/inventory-api.service')

async function main() {
  const payload = await getProductsByArea()
  const products = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.products) ? payload.products
    : []
  const areas = [...new Set(products.map((product) =>
    product.area || product.Area || product.departamento || product.Departamento || product.categoria || product.Categoria || product.sector || 'Unknown'
  ))].sort()

  console.log('Total products:', products.length)
  console.log('Areas:', areas.join(' | '))
  for (const product of products.slice(0, 5)) {
    console.log('Product fields:', Object.keys(product).join(', '))
  }
}

main().catch(e => console.error('ERROR:', e.message))
