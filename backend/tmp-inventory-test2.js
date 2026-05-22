require('dotenv').config();
const {getProductById, discountProduct, getServiceToken} = require('./src/services/inventory-api.service');
(async () => {
  try {
    const token = await getServiceToken({forceRefreshStatic: true});
    console.log('SERVICE TOKEN length', token.length);
  } catch (e) {
    console.error('SERVICE TOKEN ERROR', e.message);
  }
  try {
    const product = await getProductById('jUE9sZN7vhxKiGTdoATi');
    console.log('GET PRODUCT OK', JSON.stringify(product, null, 2));
  } catch (e) {
    console.error('GET PRODUCT ERROR', e.message);
  }
  try {
    const discount = await discountProduct('jUE9sZN7vhxKiGTdoATi', 1, null);
    console.log('DISCOUNT OK', JSON.stringify(discount, null, 2));
  } catch (e) {
    console.error('DISCOUNT ERROR', e.message);
  }
})();
