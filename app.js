const defaultCategories = ['Orthopedic', 'General medicines', 'Injections', 'Surgical supplies', 'Medical devices'];
const defaultItems = [
  { id: 'item-1', name: 'Knee stabilizer brace', category: 'Orthopedic', price: 690, stock: 14, description: 'Adjustable support brace. Confirm size availability before ordering.', emoji: '🦿' },
  { id: 'item-2', name: 'Lumbar support belt', category: 'Orthopedic', price: 850, stock: 8, description: 'Back support belt available in multiple sizes.', emoji: '🩹' },
  { id: 'item-3', name: 'Elastic crepe bandage', category: 'Orthopedic', price: 85, stock: 30, description: 'Reusable elastic bandage in standard size.', emoji: '🩹' },
  { id: 'item-4', name: 'Paracetamol tablets', category: 'General medicines', price: 28, stock: 40, description: 'Pack size and current brand supplied as stocked.', emoji: '💊' },
  { id: 'item-5', name: 'Oral rehydration salts', category: 'General medicines', price: 22, stock: 35, description: 'Single sachet. Check pack details at purchase.', emoji: '🧃' },
  { id: 'item-6', name: 'Antacid tablets', category: 'General medicines', price: 48, stock: 18, description: 'Pack size and current brand supplied as stocked.', emoji: '💊' },
  { id: 'item-7', name: 'Insulin injection', category: 'Injections', price: 320, stock: 0, description: 'Prescription-required product. Dispensing subject to local rules.', emoji: '💉' },
  { id: 'item-8', name: 'Vitamin B-complex injection', category: 'Injections', price: 95, stock: 6, description: 'Prescription requirements depend on product and local rules.', emoji: '💉' },
  { id: 'item-9', name: 'Disposable syringes, 5 ml', category: 'Injections', price: 12, stock: 250, description: 'Sterile, single-use syringes. Box quantities available.', emoji: '🧪' },
  { id: 'item-10', name: 'Sterile gauze pads', category: 'Surgical supplies', price: 45, stock: 40, description: 'Individually packed sterile dressing pads.', emoji: '🩹' },
  { id: 'item-11', name: 'Nitrile examination gloves', category: 'Surgical supplies', price: 240, stock: 16, description: 'Powder-free gloves. Multiple sizes may be available.', emoji: '🧤' },
  { id: 'item-12', name: 'Digital thermometer', category: 'Medical devices', price: 180, stock: 7, description: 'Digital thermometer with display and storage case.', emoji: '🌡️' },
];

const artColors = {
  Orthopedic: '#d9e8c9',
  'General medicines': '#d6e5e0',
  Injections: '#f0d7c8',
  'Surgical supplies': '#eee1b9',
  'Medical devices': '#e5dce9',
};
const storageKey = 'aqua-chemi-items';
const categoryStorageKey = 'aqua-chemi-categories';
const productImageBucket = 'product-images';
const maxProductImageBytes = 5 * 1024 * 1024;
const maxCompressedImageBytes = 400 * 1024;
const SHOPKEEPER_PASSWORD = 'AC';
const config = window.AQUA_CHEMI_CONFIG || {};
const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabasePublishableKey);
const supabaseClient = hasSupabaseConfig && window.supabase?.createClient
  ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
  : null;
const grid = document.querySelector('#product-grid');
const categoryList = document.querySelector('#category-list');
const searchInput = document.querySelector('#search-input');
const sortSelect = document.querySelector('#sort-select');
const resultCount = document.querySelector('#result-count');
const emptyState = document.querySelector('#empty-state');
const dialog = document.querySelector('#item-dialog');
const itemForm = document.querySelector('#item-form');
const passwordDialog = document.querySelector('#password-dialog');
const passwordForm = document.querySelector('#password-form');
const loginDialog = document.querySelector('#login-dialog');
const loginForm = document.querySelector('#login-form');
const qrDialog = document.querySelector('#qr-dialog');
const qrCode = document.querySelector('#qr-code');
const toast = document.querySelector('#toast');
const variantsDialog = document.querySelector('#variants-dialog');
let activeProductGroup = null;
let items = [];
let order = [];
let categories = [...defaultCategories];
let activeCategory = 'All items';
let activeCompany = 'All companies';
let managerMode = false;
let toastTimeout;
let authUser = null;
let realtimeChannel = null;
let pendingProductImage = null;
let removeProductImage = false;
let previewObjectUrl = '';

function loadDemoItems() {
  try {
    const saved = localStorage.getItem(storageKey);
    const parsed = saved ? JSON.parse(saved) : null;
    if (Array.isArray(parsed) && parsed.every((item) => item && typeof item === 'object')) return parsed;
  } catch (error) {
    console.warn('Saved shop stock could not be read.', error);
  }
  return defaultItems.map((item) => ({ ...item }));
}

function saveDemoItems() {
  localStorage.setItem(storageKey, JSON.stringify(items));
}

function loadDemoCategories() {
  let hasSavedCategories = false;
  try {
    const saved = localStorage.getItem(categoryStorageKey);
    const parsed = saved ? JSON.parse(saved) : null;
    if (Array.isArray(parsed)) {
      categories = parsed.filter((category) => typeof category === 'string');
      hasSavedCategories = true;
    }
  } catch (error) {
    console.warn('Saved product categories could not be read.', error);
  }
  if (!hasSavedCategories) categories = [...defaultCategories];
  categories = [...new Set([...categories, ...items.map((item) => item.category).filter(Boolean)])];
}

function saveDemoCategories() {
  localStorage.setItem(categoryStorageKey, JSON.stringify(categories));
}

function fromDatabaseRow(row) {
  return {
    id: row.id,
    name: row.name,
    company: row.company || '',
    sizes: Array.isArray(row.sizes) ? row.sizes : [],
    imageUrl: row.image_url || '',
    isAvailable: row.is_available === null || row.is_available === undefined
      ? Number(row.stock) > 0
      : Boolean(row.is_available),
    tallyKey: row.tally_key || '',
    category: row.category,
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    stock: Number(row.stock),
    description: row.description || '',
    emoji: row.emoji || '📦',
    sortOrder: Number(row.sort_order) || 0,
  };
}

function toDatabaseRow(item) {
  return {
    id: item.id,
    name: item.name,
    company: item.company || '',
    sizes: Array.isArray(item.sizes) ? item.sizes : [],
    image_url: item.imageUrl || '',
    is_available: getItemAvailability(item),
    tally_key: item.tallyKey || null,
    category: item.category,
    price: item.price,
    wholesale_price: 0,
    minimum_wholesale_qty: 1,
    stock: item.stock,
    description: item.description,
    emoji: item.emoji,
    sort_order: item.sortOrder,
  };
}

function setSyncStatus(message, state) {
  const status = document.querySelector('#sync-status');
  status.textContent = message;
  status.dataset.state = state;
}

async function loadLiveItems() {
  const { data, error } = await supabaseClient
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) {
    setSyncStatus('Live stock unavailable', 'offline');
    showToast(`Could not load shared stock: ${error.message}`);
    return;
  }
  items = data.map(fromDatabaseRow);
  render();
  setSyncStatus('Live stock connected', 'live');
}

async function loadLiveCategories() {
  const { data, error } = await supabaseClient
    .from('product_categories')
    .select('name')
    .order('name', { ascending: true });
  if (error) {
    showToast(`Could not load shared categories: ${error.message}. Run the updated Supabase setup.sql.`);
    categories = [...new Set([...defaultCategories, ...items.map((item) => item.category).filter(Boolean)])];
    render();
    return;
  }
  categories = [...new Set(data.map((row) => row.name))];
  render();
}

function subscribeToLiveItems() {
  realtimeChannel = supabaseClient
    .channel('aqua-chemi-products')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
      loadLiveItems();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'product_categories' }, () => {
      loadLiveCategories();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setSyncStatus('Live updates disconnected', 'offline');
      }
    });
}

async function initializeInventory() {
  if (hasSupabaseConfig) {
    if (!supabaseClient) {
      setSyncStatus('Supabase client unavailable', 'offline');
      showToast('Could not connect to Supabase. Check your internet connection and config.');
      return;
    }
    setSyncStatus('Connecting shared stock…', 'loading');
    await loadLiveItems();
    await loadLiveCategories();
    subscribeToLiveItems();
    const { data } = await supabaseClient.auth.getSession();
    authUser = data.session?.user || null;
    updateManagerButton();
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      authUser = session?.user || null;
      if (!authUser && managerMode) setManagerMode(false);
      updateManagerButton();
    });
    return;
  }
  items = loadDemoItems();
  loadDemoCategories();
  render();
  setSyncStatus('Demo stock · this browser only', 'demo');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function formatPrice(price) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(price) || 0);
}

function getItemPrice(item) {
  if (item.price === null || item.price === undefined || item.price === '') return null;
  const price = Number(item.price);
  return Number.isFinite(price) ? price : null;
}

function formatMrp(price) {
  return price === null ? 'MRP not set' : `MRP ${formatPrice(price)}`;
}

function getItemAvailability(item) {
  return typeof item.isAvailable === 'boolean'
    ? item.isAvailable
    : Number(item.stock) > 0;
}

function renderCategories() {
  const choices = ['All items', ...categories];
  if (!choices.includes(activeCategory)) activeCategory = 'All items';
  categoryList.innerHTML = choices.map((category) => `
    <button class="category-button" type="button" data-category="${escapeHtml(category)}" aria-pressed="${activeCategory === category}">
      ${escapeHtml(category)}
    </button>`).join('');
  const companyFilter = document.querySelector('#company-filter');
  const companies = [...new Set(items.map((item) => String(item.company || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  if (!companies.includes(activeCompany)) activeCompany = 'All companies';
  companyFilter.innerHTML = ['All companies', ...companies].map((company) => `
    <option value="${escapeHtml(company)}" ${activeCompany === company ? 'selected' : ''}>${escapeHtml(company)}</option>`).join('');
  document.querySelector('#company-options').innerHTML = companies.map((company) => `
    <option value="${escapeHtml(company)}"></option>`).join('');
  const itemCategory = document.querySelector('#item-category');
  const selectedCategory = itemCategory.value;
  itemCategory.innerHTML = categories.map((category) => `
    <option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  itemCategory.value = categories.includes(selectedCategory) ? selectedCategory : (categories[0] || '');
}

function getItemSizes(item) {
  const sizes = Array.isArray(item.sizes)
    ? item.sizes.map((size) => String(size).trim()).filter(Boolean)
    : [];
  return sizes.length ? [...new Set(sizes)] : ['Standard'];
}

function parseItemSizes(value) {
  const sizes = new Map();
  String(value || '').split(',').map((size) => size.trim()).filter(Boolean).forEach((size) => {
    const key = size.toLocaleLowerCase();
    if (!sizes.has(key)) sizes.set(key, size);
  });
  return [...sizes.values()];
}

function getOrderQuantity(itemId) {
  return order
    .filter((line) => line.itemId === itemId)
    .reduce((total, line) => total + line.quantity, 0);
}

function updateOrderButton() {
  const count = order.reduce((total, line) => total + line.quantity, 0);
  document.querySelector('#order-count').textContent = String(count);
  document.querySelector('#variant-order-count').textContent = String(count);
}

function getVisibleItems() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const visible = items.filter((item) => {
    const matchesCategory = activeCategory === 'All items' || item.category === activeCategory;
    const matchesCompany = activeCompany === 'All companies' || String(item.company || '').trim() === activeCompany;
    const searchable = `${item.name} ${item.company || ''} ${getItemSizes(item).join(' ')} ${item.category} ${item.description}`.toLocaleLowerCase();
    return matchesCategory && matchesCompany && searchable.includes(query);
  });
  return visible;
}

function getProductGroupKey(item) {
  return encodeURIComponent(JSON.stringify([item.name.trim().toLocaleLowerCase(), item.category]));
}

function getProductGroups(visibleItems) {
  const grouped = new Map();
  visibleItems.forEach((item) => {
    const key = getProductGroupKey(item);
    if (!grouped.has(key)) grouped.set(key, { key, name: item.name, category: item.category, variants: [] });
    grouped.get(key).variants.push(item);
  });
  const groups = [...grouped.values()];
  const sort = sortSelect.value;
  if (sort === 'name') groups.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'price-low' || sort === 'price-high') {
    const groupMrp = (group) => {
      const prices = group.variants.map(getItemPrice).filter((price) => price !== null);
      if (!prices.length) return null;
      return sort === 'price-low' ? Math.min(...prices) : Math.max(...prices);
    };
    groups.sort((a, b) => {
      const priceA = groupMrp(a);
      const priceB = groupMrp(b);
      if (priceA === null || priceB === null) {
        return priceA === priceB ? 0 : priceA === null ? 1 : -1;
      }
      return sort === 'price-low' ? priceA - priceB : priceB - priceA;
    });
  }
  return groups;
}

function renderItems() {
  const visible = getVisibleItems();
  const groups = getProductGroups(visible);
  resultCount.textContent = `${groups.length} ${groups.length === 1 ? 'product' : 'products'} · ${visible.length} ${visible.length === 1 ? 'variant' : 'variants'}`;
  document.querySelector('#footer-stock').textContent = `${items.length} GOODS ON THE SHELVES`;
  emptyState.hidden = groups.length > 0;
  grid.hidden = groups.length === 0;
  updateOrderButton();
  grid.innerHTML = groups.map((group, index) => {
    const available = group.variants.some(getItemAvailability);
    const companies = [...new Set(group.variants.map((item) => String(item.company || '').trim()).filter(Boolean))];
    const representative = group.variants[0];
    const hasCompanyVariants = companies.length > 0;
    const companySummary = companies.length
      ? `${companies.length} ${companies.length === 1 ? 'company' : 'companies'} available`
      : representative.tallyKey ? 'Company/brand included in item name' : 'Company details available on selection';
    const productImage = group.variants
      .map((item) => getSafeProductImageUrl(item.imageUrl))
      .find(Boolean) || '';
    const prices = group.variants.map(getItemPrice).filter((price) => price !== null);
    const minPrice = prices.length ? Math.min(...prices) : null;
    return `
      <article class="product-card" style="--art-bg:${escapeHtml(artColors[group.category] || '#e6e9df')}; animation-delay:${Math.min(index, 7) * 35}ms">
        <div class="product-art ${productImage ? 'has-photo' : ''}">
          <span class="stock-badge ${available ? '' : 'out'}">${available ? 'AVAILABLE' : 'NOT AVAILABLE'}</span>
          ${productImage ? `<img class="product-photo" src="${escapeHtml(productImage)}" alt="${escapeHtml(group.name)}" />` : ''}
          <span class="product-emoji" aria-hidden="true">${escapeHtml(representative.emoji || '📦')}</span>
        </div>
        <div class="product-info">
          <p class="product-category">${escapeHtml(group.category)}</p>
          <button class="product-name product-open-button" type="button" data-open-product="${escapeHtml(group.key)}" aria-label="View ${hasCompanyVariants ? 'companies and sizes' : 'item details'} for ${escapeHtml(group.name)}">${escapeHtml(group.name)}</button>
          <p class="product-company">${escapeHtml(companySummary)}</p>
          <p class="product-description">${escapeHtml(representative.description || (representative.tallyKey
    ? 'Company/brand details are included in the Tally item name.'
    : 'Choose a company and size to view details.'))}</p>
          <div class="product-bottom">
            <span class="product-pricing">
              <span class="product-price">${escapeHtml(formatMrp(minPrice))}</span>
              <span class="product-option-count">${group.variants.length} ${group.variants.length === 1 ? (hasCompanyVariants ? 'company option' : 'item option') : (hasCompanyVariants ? 'company options' : 'item options')}</span>
            </span>
            <span class="quantity ${available ? '' : 'unavailable'}">${available ? 'Available' : 'Not available'}</span>
          </div>
          <button class="view-options-button" type="button" data-open-product="${escapeHtml(group.key)}">${hasCompanyVariants ? 'View companies & sizes' : 'View item details'} <span aria-hidden="true">→</span></button>
        </div>
      </article>`;
  }).join('');
  bindProductImageFallbacks(grid);
}

function render() {
  renderCategories();
  renderCategoryManager();
  renderItems();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function getInventoryErrorMessage(error) {
  const message = error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : String(error);
  if (/Could not find the 'tally_key' column of 'products' in the schema cache/i.test(message)) {
    return 'Supabase needs the Tally sync database update. Run supabase/setup.sql in the Supabase SQL Editor, then refresh this page.';
  }
  if (/Could not find the '(company|sizes)' column of 'products' in the schema cache/i.test(message)) {
    return 'Supabase needs a database update before items can be saved. Run supabase/setup.sql in the Supabase SQL Editor, then refresh this page.';
  }
  if (/Could not find the 'image_url' column of 'products' in the schema cache/i.test(message)) {
    return 'Supabase needs the latest database setup before product images can be saved. Run supabase/setup.sql in the Supabase SQL Editor, then refresh this page.';
  }
  if (/Could not find the 'is_available' column of 'products' in the schema cache/i.test(message)) {
    return 'Supabase needs the availability update before items can be saved. Run supabase/setup.sql in the Supabase SQL Editor, then refresh this page.';
  }
  if (/product_categories|rename_product_category|delete_product_category/i.test(message)
    && /(schema cache|does not exist|could not find|unknown function)/i.test(message)) {
    return 'Supabase category setup is missing. Run supabase/setup.sql in the Supabase SQL Editor, then refresh this page.';
  }
  return message;
}

function openItemDialog(item, defaults = {}) {
  renderCategories();
  itemForm.reset();
  pendingProductImage = null;
  removeProductImage = false;
  document.querySelector('#item-id').value = item?.id || '';
  document.querySelector('#dialog-title').textContent = item ? 'Edit company variant' : defaults.name ? 'Add company variant' : 'Add an item';
  document.querySelector('#item-name').value = item?.name || defaults.name || '';
  document.querySelector('#item-company').value = item?.company || '';
  document.querySelector('#item-sizes').value = Array.isArray(item?.sizes) ? item.sizes.join(', ') : '';
  document.querySelector('#item-category').value = item?.category
    || defaults.category
    || (activeCategory !== 'All items' ? activeCategory : categories[0])
    || '';
  document.querySelector('#item-emoji').value = item?.emoji || '📦';
  document.querySelector('#item-price').value = item?.price ?? '';
  document.querySelector('#item-stock').value = item?.stock ?? '';
  document.querySelector('#item-availability').value = String(item ? getItemAvailability(item) : defaults.isAvailable ?? true);
  document.querySelector('#item-description').value = item?.description || '';
  setProductImagePreview(item?.imageUrl || '');
  if (!item && defaults.emoji) document.querySelector('#item-emoji').value = defaults.emoji;
  if (!item && defaults.description) document.querySelector('#item-description').value = defaults.description;
  dialog.showModal();
  document.querySelector('#item-name').focus();
}

function getSafeProductImageUrl(value) {
  const imageUrl = String(value || '');
  return /^https?:\/\//i.test(imageUrl) || /^data:image\/(?:jpeg|png|webp);base64,/i.test(imageUrl)
    ? imageUrl
    : '';
}

function setProductImagePreview(imageUrl) {
  const preview = document.querySelector('#item-image-preview');
  const removeButton = document.querySelector('#remove-item-image');
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = String(imageUrl || '').startsWith('blob:') ? String(imageUrl) : '';
  const safeImageUrl = previewObjectUrl || getSafeProductImageUrl(imageUrl);
  preview.src = safeImageUrl;
  preview.hidden = !safeImageUrl;
  removeButton.hidden = !safeImageUrl;
}

function bindProductImageFallbacks(container) {
  container.querySelectorAll('.product-photo, .variant-photo').forEach((image) => {
    image.addEventListener('error', () => {
      image.remove();
      image.parentElement.classList.remove('has-photo');
    }, { once: true });
  });
}

async function prepareProductImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
  if (file.size > maxProductImageBytes) throw new Error('Image must be 5 MB or smaller');
  const bitmap = await createImageBitmap(file);
  const makeBlob = (maxDimension, quality) => new Promise((resolve, reject) => {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Could not process this image'));
      return;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not process this image')), 'image/jpeg', quality);
  });
  try {
    let blob = await makeBlob(1200, 0.8);
    if (blob.size > maxCompressedImageBytes) blob = await makeBlob(800, 0.65);
    if (blob.size > maxCompressedImageBytes) throw new Error('Image is too detailed to store. Choose a smaller image.');
    return blob;
  } finally {
    bitmap.close();
  }
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected image'));
    reader.readAsDataURL(blob);
  });
}

async function saveProductImage(file, itemId) {
  const blob = await prepareProductImage(file);
  if (!supabaseClient) return readBlobAsDataUrl(blob);
  const path = `${itemId}/${Date.now()}.jpg`;
  const { error } = await supabaseClient.storage
    .from(productImageBucket)
    .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new Error('Product image storage is not set up yet. Run the updated supabase/setup.sql, then retry.');
    }
    throw error;
  }
  const { data } = supabaseClient.storage.from(productImageBucket).getPublicUrl(path);
  return data.publicUrl;
}

function openProductOptions(groupKey) {
  const group = getProductGroups(getVisibleItems()).find((entry) => entry.key === groupKey);
  if (!group) return;
  activeProductGroup = group;
  document.querySelector('#variants-title').textContent = group.name;
  document.querySelector('#variants-category').textContent = group.category;
  document.querySelector('.variants-intro').textContent = group.variants.some((item) => String(item.company || '').trim())
    ? 'Choose a company and size to see its current MRP and availability.'
    : 'Review the item, available size, current MRP, and availability.';
  document.querySelector('#variant-manager-actions').hidden = !managerMode;
  const variantList = document.querySelector('#variant-list');
  variantList.innerHTML = group.variants.map((item) => {
    const available = getItemAvailability(item);
    const sizes = getItemSizes(item);
    const productImage = getSafeProductImageUrl(item.imageUrl);
    return `
      <article class="variant-card ${productImage ? 'has-photo' : ''}">
        ${productImage ? `<img class="variant-photo" src="${escapeHtml(productImage)}" alt="${escapeHtml(item.name)} - ${escapeHtml(item.company || 'product')}" />` : ''}
        <div class="variant-heading">
          <div>
            <h3>${escapeHtml(item.company || (item.tallyKey ? 'Brand included in item name' : 'Company not specified'))}</h3>
            <p class="quantity ${available ? '' : 'unavailable'}">${available ? 'Available' : 'Not available'}</p>
          </div>
          ${managerMode ? `<div class="variant-admin-actions">
            <button class="category-action-button" type="button" data-variant-edit="${escapeHtml(item.id)}">Edit</button>
            <button class="category-action-button delete" type="button" data-variant-delete="${escapeHtml(item.id)}">Delete</button>
          </div>` : ''}
        </div>
        <div class="variant-meta">
          <span>${escapeHtml(formatMrp(getItemPrice(item)))}</span>
        </div>
        <div class="variant-order-row">
          <label class="field">Size
            <select class="variant-size" aria-label="Size for ${escapeHtml(item.company || item.name)}" ${available ? '' : 'disabled'}>
              ${sizes.map((size) => `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join('')}
            </select>
          </label>
          <label class="field variant-quantity-field">Quantity
            <input class="variant-quantity" type="number" min="1" value="1" aria-label="Quantity for ${escapeHtml(item.company || item.name)}" ${available ? '' : 'disabled'} />
          </label>
          <button class="add-order-item" type="button" data-variant-add="${escapeHtml(item.id)}" ${available ? '' : 'disabled'}>Add to order</button>
        </div>
      </article>`;
  }).join('');
  bindProductImageFallbacks(variantList);
  variantsDialog.showModal();
}

function renderCategoryManager() {
  const list = document.querySelector('#category-manager-list');
  if (!list) return;
  list.innerHTML = categories.map((category) => {
    const count = items.filter((item) => item.category === category).length;
    return `
      <div class="category-manager-row">
        <label class="field">
          <span class="visually-hidden">Category name</span>
          <input type="text" maxlength="60" value="${escapeHtml(category)}" data-category-name="${escapeHtml(category)}" aria-label="Category name: ${escapeHtml(category)}" />
        </label>
        <span class="category-item-count">${count} ${count === 1 ? 'item' : 'items'}</span>
        <button class="category-action-button" type="button" data-category-action="save" data-category="${escapeHtml(category)}">Save</button>
        <button class="category-action-button" type="button" data-category-action="add-item" data-category="${escapeHtml(category)}">Add item</button>
        <button class="category-action-button delete" type="button" data-category-action="delete" data-category="${escapeHtml(category)}" aria-label="Delete ${escapeHtml(category)} category">Delete</button>
      </div>`;
  }).join('');
}

function openCategoryDialog() {
  renderCategoryManager();
  document.querySelector('#category-dialog').showModal();
  document.querySelector('#new-category-name').focus();
}

function normalizeCategoryName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function findCategoryDuplicate(name, excluding = '') {
  const normalized = name.toLocaleLowerCase();
  return categories.some((category) => category !== excluding && category.toLocaleLowerCase() === normalized);
}

async function addCategory(name) {
  const normalized = normalizeCategoryName(name);
  if (!normalized) {
    showToast('Enter a category name');
    return false;
  }
  if (findCategoryDuplicate(normalized)) {
    showToast('That category already exists');
    return false;
  }
  if (supabaseClient) {
    const { error } = await supabaseClient.from('product_categories').insert({ name: normalized });
    if (error) throw error;
    await loadLiveCategories();
  } else {
    categories = [...categories, normalized];
    saveDemoCategories();
    render();
  }
  showToast(`${normalized} category added`);
  return true;
}

async function renameCategory(oldName, newName) {
  const normalized = normalizeCategoryName(newName);
  if (!normalized) {
    showToast('Enter a category name');
    return false;
  }
  if (normalized === oldName) return true;
  if (findCategoryDuplicate(normalized, oldName)) {
    showToast('That category already exists');
    return false;
  }
  if (supabaseClient) {
    const { error } = await supabaseClient.rpc('rename_product_category', {
      old_name: oldName,
      new_name: normalized,
    });
    if (error) throw error;
    await Promise.all([loadLiveItems(), loadLiveCategories()]);
  } else {
    categories = categories.map((category) => category === oldName ? normalized : category);
    items = items.map((item) => item.category === oldName ? { ...item, category: normalized } : item);
    if (activeCategory === oldName) activeCategory = normalized;
    saveDemoCategories();
    saveDemoItems();
    render();
  }
  showToast(`${oldName} renamed to ${normalized}`);
  return true;
}

async function deleteCategory(category) {
  const count = items.filter((item) => item.category === category).length;
  if (count > 0) {
    showToast(`Move or delete all ${count} ${count === 1 ? 'item' : 'items'} in ${category} before deleting it`);
    return;
  }
  if (supabaseClient) {
    const { error } = await supabaseClient.rpc('delete_product_category', { category_name: category });
    if (error) throw error;
    await loadLiveCategories();
  } else {
    categories = categories.filter((entry) => entry !== category);
    if (activeCategory === category) activeCategory = 'All items';
    saveDemoCategories();
    render();
  }
  showToast(`${category} category deleted`);
}

function renderOrderCart() {
  const orderLines = document.querySelector('#order-lines');
  const orderTotal = document.querySelector('#order-total');
  const sendButton = document.querySelector('#send-order');
  const lines = order.map((line) => ({
    ...line,
    item: items.find((item) => item.id === line.itemId),
  })).filter((line) => line.item);
  if (lines.length !== order.length) {
    order = lines.map(({ item, ...line }) => line);
    updateOrderButton();
  }
  if (lines.length === 0) {
    orderLines.innerHTML = '<p class="empty-order">Your order is empty. Add products from the catalog first.</p>';
    orderTotal.textContent = '';
    sendButton.disabled = true;
    return;
  }
  sendButton.disabled = false;
  orderLines.innerHTML = lines.map(({ item, size, quantity }) => {
    const unitPrice = getItemPrice(item);
    return `
      <div class="order-line">
        <div class="order-line-details">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${item.company ? `${escapeHtml(item.company)} · ` : ''}${escapeHtml(size)}</span>
          <span>${unitPrice === null ? 'Price to be confirmed' : `${formatPrice(unitPrice)} each`}</span>
        </div>
        <label class="order-line-quantity">Qty
          <input type="number" min="1" value="${quantity}" data-order-quantity="${escapeHtml(item.id)}" data-order-size="${escapeHtml(size)}" aria-label="Order quantity for ${escapeHtml(item.name)} (${escapeHtml(size)})" />
        </label>
        <button class="remove-order-item" type="button" data-order-remove="${escapeHtml(item.id)}" data-order-size="${escapeHtml(size)}" aria-label="Remove ${escapeHtml(item.name)} (${escapeHtml(size)})">×</button>
      </div>`;
  }).join('');
  const hasUnpricedItems = lines.some(({ item }) => getItemPrice(item) === null);
  if (hasUnpricedItems) {
    orderTotal.textContent = 'Some items have no MRP listed; the shopkeeper will confirm prices and total.';
  } else {
    const total = lines.reduce((sum, { item, quantity }) => sum + getItemPrice(item) * quantity, 0);
    orderTotal.textContent = `Estimated total: ${formatPrice(total)}`;
  }
}

function openOrderDialog() {
  renderOrderCart();
  document.querySelector('#order-dialog').showModal();
}

function updateManagerButton() {
  const modeButton = document.querySelector('#mode-toggle');
  modeButton.setAttribute('aria-pressed', String(managerMode));
  document.querySelector('#mode-label').textContent = managerMode
    ? 'Exit shopkeeper mode'
    : hasSupabaseConfig ? 'Shopkeeper sign in' : 'Shopkeeper mode';
}

function setManagerMode(enabled) {
  managerMode = enabled;
  updateManagerButton();
  document.querySelector('#add-item').hidden = !managerMode;
  document.querySelector('#manage-categories').hidden = !managerMode;
  renderItems();
}

renderCategories();
render();
initializeInventory();

document.querySelector('#mode-toggle').addEventListener('click', async () => {
  if (managerMode) {
    setManagerMode(false);
    if (supabaseClient) await supabaseClient.auth.signOut({ scope: 'local' });
    return;
  }
  if (hasSupabaseConfig) {
    if (!supabaseClient) {
      showToast('Supabase is not available. Check the client script and configuration.');
      return;
    }
    if (authUser) {
      setManagerMode(true);
      return;
    }
    loginForm.reset();
    document.querySelector('#login-error').hidden = true;
    loginDialog.showModal();
    document.querySelector('#login-email').focus();
    return;
  }
  passwordForm.reset();
  document.querySelector('#password-error').hidden = true;
  passwordDialog.showModal();
  document.querySelector('#shopkeeper-password').focus();
});

passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const passwordInput = document.querySelector('#shopkeeper-password');
  if (passwordInput.value !== SHOPKEEPER_PASSWORD) {
    document.querySelector('#password-error').hidden = false;
    passwordInput.value = '';
    passwordInput.focus();
    return;
  }
  passwordDialog.close();
  passwordForm.reset();
  setManagerMode(true);
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorMessage = document.querySelector('#login-error');
  errorMessage.hidden = true;
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: document.querySelector('#login-email').value.trim(),
    password: document.querySelector('#login-password').value,
  });
  if (error) {
    errorMessage.textContent = 'Sign-in failed. Check your email and password.';
    errorMessage.hidden = false;
    return;
  }
  authUser = data.user;
  loginDialog.close();
  setManagerMode(true);
});

document.querySelector('#close-login').addEventListener('click', () => loginDialog.close());
document.querySelector('#cancel-login').addEventListener('click', () => loginDialog.close());
loginDialog.addEventListener('click', (event) => {
  if (event.target === loginDialog) loginDialog.close();
});

document.querySelector('#close-password').addEventListener('click', () => passwordDialog.close());
document.querySelector('#cancel-password').addEventListener('click', () => passwordDialog.close());
passwordDialog.addEventListener('click', (event) => {
  if (event.target === passwordDialog) passwordDialog.close();
});

categoryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  activeCategory = button.dataset.category;
  render();
});

document.querySelector('#company-filter').addEventListener('change', (event) => {
  activeCompany = event.target.value;
  renderItems();
});
searchInput.addEventListener('input', renderItems);
sortSelect.addEventListener('change', renderItems);
document.querySelector('#add-item').addEventListener('click', () => openItemDialog());
document.querySelector('#clear-filters').addEventListener('click', () => {
  searchInput.value = '';
  activeCategory = 'All items';
  activeCompany = 'All companies';
  render();
});

grid.addEventListener('click', async (event) => {
  const productButton = event.target.closest('[data-open-product]');
  if (productButton) {
    openProductOptions(productButton.dataset.openProduct);
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const item = items.find((entry) => entry.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.action === 'order-add') {
    const card = button.closest('.product-card');
    const size = card.querySelector('.order-size').value;
    const quantity = Number(card.querySelector('.order-quantity').value);
    const stock = Math.max(0, Number(item.stock) || 0);
    const existing = order.find((line) => line.itemId === item.id && line.size === size);
    const nextQuantity = (existing?.quantity || 0) + quantity;
    if (!getItemAvailability(item)) {
      showToast(`${item.name} is not available`);
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || (stock > 0 && getOrderQuantity(item.id) + quantity > stock)) {
      showToast('Requested quantity is not available. Please contact the shopkeeper.');
      return;
    }
    if (existing) existing.quantity = nextQuantity;
    else order.push({ itemId: item.id, size, quantity });
    updateOrderButton();
    showToast(`${item.name} added to your order`);
    return;
  }
  if (button.dataset.action === 'edit') openItemDialog(item);
  if (button.dataset.action === 'delete' && window.confirm(`Delete “${item.name}” from the shop stock?`)) {
    try {
      if (supabaseClient) {
        const { error } = await supabaseClient.from('products').delete().eq('id', item.id);
        if (error) throw error;
        await loadLiveItems();
      } else {
        items = items.filter((entry) => entry.id !== item.id);
        saveDemoItems();
        render();
      }
      showToast(`${item.name} deleted`);
    } catch (error) {
      showToast(`Delete failed: ${error.message}`);
    }
  }
});

document.querySelector('#variant-list').addEventListener('click', async (event) => {
  const addButton = event.target.closest('[data-variant-add]');
  if (addButton) {
    const item = items.find((entry) => entry.id === addButton.dataset.variantAdd);
    const card = addButton.closest('.variant-card');
    if (!item || !card) return;
    const size = card.querySelector('.variant-size').value;
    const quantity = Number(card.querySelector('.variant-quantity').value);
    const stock = Math.max(0, Number(item.stock) || 0);
    const existing = order.find((line) => line.itemId === item.id && line.size === size);
    if (!getItemAvailability(item)) {
      showToast(`${item.name} is not available`);
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || (stock > 0 && getOrderQuantity(item.id) + quantity > stock)) {
      showToast('Requested quantity is not available. Please contact the shopkeeper.');
      return;
    }
    if (existing) existing.quantity += quantity;
    else order.push({ itemId: item.id, size, quantity });
    updateOrderButton();
    showToast(`${item.company || item.name} added to your order`);
    return;
  }
  const editButton = event.target.closest('[data-variant-edit]');
  if (editButton) {
    const item = items.find((entry) => entry.id === editButton.dataset.variantEdit);
    if (!item) return;
    variantsDialog.close();
    openItemDialog(item);
    return;
  }
  const deleteButton = event.target.closest('[data-variant-delete]');
  if (!deleteButton) return;
  const item = items.find((entry) => entry.id === deleteButton.dataset.variantDelete);
  if (!item || !window.confirm(`Delete ${item.company || item.name} — ${item.name}?`)) return;
  try {
    if (supabaseClient) {
      const { error } = await supabaseClient.from('products').delete().eq('id', item.id);
      if (error) throw error;
      await loadLiveItems();
    } else {
      items = items.filter((entry) => entry.id !== item.id);
      order = order.filter((line) => line.itemId !== item.id);
      saveDemoItems();
      render();
    }
    if (activeProductGroup && items.some((entry) => getProductGroupKey(entry) === getProductGroupKey(activeProductGroup))) {
      openProductOptions(getProductGroupKey(activeProductGroup));
    } else {
      variantsDialog.close();
    }
    showToast(`${item.name} variant deleted`);
  } catch (error) {
    showToast(`Delete failed: ${error.message}`);
  }
});

document.querySelector('#close-variants').addEventListener('click', () => variantsDialog.close());
document.querySelector('#close-variants-shopping').addEventListener('click', () => variantsDialog.close());
document.querySelector('#review-order-from-variants').addEventListener('click', () => {
  variantsDialog.close();
  openOrderDialog();
});
variantsDialog.addEventListener('click', (event) => {
  if (event.target === variantsDialog) variantsDialog.close();
});
document.querySelector('#add-company-variant').addEventListener('click', () => {
  if (!managerMode || !activeProductGroup) return;
  const defaults = {
    name: activeProductGroup.name,
    category: activeProductGroup.category,
    emoji: activeProductGroup.variants[0]?.emoji,
    description: activeProductGroup.variants[0]?.description,
  };
  variantsDialog.close();
  openItemDialog(null, defaults);
});

itemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!managerMode) {
    showToast('Sign in as shopkeeper to update inventory');
    return;
  }
  if (!itemForm.reportValidity()) return;
  const id = document.querySelector('#item-id').value;
  const existing = items.find((item) => item.id === id);
  const item = {
    id: id || (crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}`),
    name: document.querySelector('#item-name').value.trim(),
    company: document.querySelector('#item-company').value.trim(),
    sizes: parseItemSizes(document.querySelector('#item-sizes').value),
    category: document.querySelector('#item-category').value,
    emoji: document.querySelector('#item-emoji').value.trim() || '📦',
    price: document.querySelector('#item-price').value === '' ? null : Number(document.querySelector('#item-price').value),
    isAvailable: document.querySelector('#item-availability').value === 'true',
    stock: Number(document.querySelector('#item-stock').value),
    tallyKey: existing?.tallyKey || '',
    description: document.querySelector('#item-description').value.trim(),
    imageUrl: existing?.imageUrl || '',
    sortOrder: existing?.sortOrder ?? Math.min(0, ...items.map((entry) => entry.sortOrder ?? 0)) - 1,
  };
  item.name = item.name.replace(/\s+/g, ' ');
  item.company = item.company.replace(/\s+/g, ' ');
  if (!categories.includes(item.category)) {
    showToast('Choose a valid category');
    return;
  }
  try {
    if (removeProductImage) item.imageUrl = '';
    if (pendingProductImage) item.imageUrl = await saveProductImage(pendingProductImage, item.id);
    if (supabaseClient) {
      const { error } = await supabaseClient.from('products').upsert(toDatabaseRow(item));
      if (error) throw error;
      await loadLiveItems();
    } else {
      if (existing) items = items.map((entry) => entry.id === id ? item : entry);
      else items.unshift(item);
      saveDemoItems();
      render();
    }
    dialog.close();
    showToast(existing ? `${item.name} updated` : `${item.name} added`);
  } catch (error) {
    showToast(`Save failed: ${getInventoryErrorMessage(error)}`);
  }
});

function handleProductImageSelection(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > maxProductImageBytes) {
    event.target.value = '';
    document.querySelector('#item-image').value = '';
    document.querySelector('#item-camera').value = '';
    showToast(file.size > maxProductImageBytes ? 'Image must be 5 MB or smaller' : 'Choose an image file');
    return;
  }
  pendingProductImage = file;
  removeProductImage = false;
  document.querySelector('#item-image').value = '';
  document.querySelector('#item-camera').value = '';
  setProductImagePreview(URL.createObjectURL(file));
}
document.querySelector('#item-image').addEventListener('change', handleProductImageSelection);
document.querySelector('#item-camera').addEventListener('change', handleProductImageSelection);
document.querySelector('#capture-item-image').addEventListener('click', () => {
  document.querySelector('#item-camera').click();
});
document.querySelector('#remove-item-image').addEventListener('click', () => {
  pendingProductImage = null;
  removeProductImage = true;
  document.querySelector('#item-image').value = '';
  document.querySelector('#item-camera').value = '';
  setProductImagePreview('');
});

document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
document.querySelector('#cancel-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

const categoryDialog = document.querySelector('#category-dialog');
const categoryForm = document.querySelector('#category-form');
document.querySelector('#manage-categories').addEventListener('click', openCategoryDialog);
document.querySelector('#close-categories').addEventListener('click', () => categoryDialog.close());
categoryDialog.addEventListener('click', (event) => {
  if (event.target === categoryDialog) categoryDialog.close();
});
categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!categoryForm.reportValidity()) return;
  try {
    const added = await addCategory(document.querySelector('#new-category-name').value);
    if (added) {
      categoryForm.reset();
      renderCategoryManager();
    }
  } catch (error) {
    showToast(`Could not add category: ${getInventoryErrorMessage(error)}`);
  }
});
document.querySelector('#category-manager-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-category-action]');
  if (!button) return;
  const category = button.dataset.category;
  if (button.dataset.categoryAction === 'add-item') {
    activeCategory = category;
    activeCompany = 'All companies';
    categoryDialog.close();
    render();
    openItemDialog();
    return;
  }
  if (button.dataset.categoryAction === 'save') {
    const newName = button.closest('.category-manager-row').querySelector('input').value;
    try {
      if (await renameCategory(category, newName)) renderCategoryManager();
    } catch (error) {
      showToast(`Could not rename category: ${getInventoryErrorMessage(error)}`);
    }
    return;
  }
  if (button.dataset.categoryAction === 'delete') {
    const hasProducts = items.some((item) => item.category === category);
    if (hasProducts) {
      showToast(`Move or delete all products in ${category} before deleting it`);
      return;
    }
    if (!window.confirm(`Delete the empty category “${category}”?`)) return;
    try {
      await deleteCategory(category);
      renderCategoryManager();
    } catch (error) {
      showToast(`Could not delete category: ${getInventoryErrorMessage(error)}`);
    }
  }
});

const orderDialog = document.querySelector('#order-dialog');
const orderForm = document.querySelector('#order-form');
document.querySelector('#open-order').addEventListener('click', openOrderDialog);
document.querySelector('#close-order').addEventListener('click', () => orderDialog.close());
document.querySelector('#continue-shopping').addEventListener('click', () => orderDialog.close());
orderDialog.addEventListener('click', (event) => {
  if (event.target === orderDialog) orderDialog.close();
});
document.querySelector('#order-lines').addEventListener('click', (event) => {
  const button = event.target.closest('[data-order-remove]');
  if (!button) return;
  order = order.filter((line) => line.itemId !== button.dataset.orderRemove || line.size !== button.dataset.orderSize);
  updateOrderButton();
  renderOrderCart();
});
document.querySelector('#order-lines').addEventListener('change', (event) => {
  const input = event.target.closest('[data-order-quantity]');
  if (!input) return;
  const quantity = Number(input.value);
  const itemId = input.dataset.orderQuantity;
  const size = input.dataset.orderSize;
  const line = order.find((entry) => entry.itemId === itemId && entry.size === size);
  const item = items.find((entry) => entry.id === itemId);
  if (!line || !item) return;
  const stock = Math.max(0, Number(item.stock) || 0);
  if (!getItemAvailability(item) || !Number.isInteger(quantity) || quantity < 1 || (stock > 0 && quantity > stock)) {
    showToast('Requested quantity is not available. Please contact the shopkeeper.');
    input.value = String(line.quantity);
    return;
  }
  line.quantity = quantity;
  updateOrderButton();
  renderOrderCart();
});
orderForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!orderForm.reportValidity()) return;
  if (order.length === 0) {
    showToast('Add at least one product to your order');
    return;
  }
  for (const line of order) {
    const item = items.find((entry) => entry.id === line.itemId);
    const stock = Math.max(0, Number(item?.stock) || 0);
    if (!item || !getItemAvailability(item) || !getItemSizes(item).includes(line.size) || (stock > 0 && line.quantity > stock)) {
      showToast(`Please update the size or availability for ${item?.name || 'an unavailable product'}`);
      renderOrderCart();
      return;
    }
  }
  const shopNumber = String(config.shopWhatsAppNumber || '').replace(/\D/g, '');
  if (shopNumber.length < 8 || shopNumber.length > 15) {
    showToast('Shop WhatsApp number is not configured. Add it in config.js with country code.');
    return;
  }
  const customerName = document.querySelector('#customer-name').value.trim();
  const customerPhone = document.querySelector('#customer-phone').value.trim();
  const notes = document.querySelector('#order-notes').value.trim();
  const lines = order.map((line) => {
    const item = items.find((entry) => entry.id === line.itemId);
    const unitPrice = getItemPrice(item);
    const brand = item.company ? `, ${item.company}` : '';
    const priceDetails = unitPrice === null
      ? 'MRP not listed; please confirm price'
      : `${formatPrice(unitPrice)} each = ${formatPrice(unitPrice * line.quantity)}`;
    return `• ${item.name}${brand} — Size: ${line.size}, Qty: ${line.quantity}, ${priceDetails}`;
  });
  const hasUnpricedItems = order.some((line) => {
    const item = items.find((entry) => entry.id === line.itemId);
    return !item || getItemPrice(item) === null;
  });
  const total = hasUnpricedItems ? null : order.reduce((sum, line) => {
    const item = items.find((entry) => entry.id === line.itemId);
    return sum + getItemPrice(item) * line.quantity;
  }, 0);
  const message = [
    'Hello, I would like to place an order from AQUA CHEMI.',
    '',
    ...lines,
    '',
    hasUnpricedItems ? 'Some items have no MRP listed; please confirm prices and total.' : `Estimated total: ${formatPrice(total)}`,
    `Name: ${customerName}`,
    customerPhone ? `Customer phone: ${customerPhone}` : '',
    notes ? `Note: ${notes}` : '',
    '',
    'Please confirm availability and final price.',
  ].filter(Boolean).join('\n');
  const whatsappUrl = `https://wa.me/${shopNumber}?text=${encodeURIComponent(message)}`;
  window.location.assign(whatsappUrl);
});

function getCatalogUrl() {
  const configuredUrl = String(config.publicCatalogUrl || '').trim();
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  }
  if (['https:', 'http:'].includes(window.location.protocol)) {
    return `${window.location.origin}${window.location.pathname}`;
  }
  return null;
}

function renderQrCode() {
  qrCode.innerHTML = '';
  const catalogUrl = getCatalogUrl();
  const status = document.querySelector('#qr-status');
  const urlLabel = document.querySelector('#qr-url');
  const downloadButton = document.querySelector('#download-qr');
  const copyButton = document.querySelector('#copy-catalog-link');
  if (!catalogUrl) {
    status.textContent = 'Publish the catalog or set its public URL in config.js to make a customer QR.';
    urlLabel.textContent = '';
    downloadButton.disabled = true;
    copyButton.disabled = true;
    return;
  }
  if (!window.QRCode) {
    status.textContent = 'QR generator did not load. Check your internet connection.';
    downloadButton.disabled = true;
    copyButton.disabled = false;
    urlLabel.textContent = catalogUrl;
    return;
  }
  status.textContent = 'This permanent link opens the latest shared stock.';
  urlLabel.textContent = catalogUrl;
  downloadButton.disabled = false;
  copyButton.disabled = false;
  new window.QRCode(qrCode, {
    text: catalogUrl,
    width: 220,
    height: 220,
    colorDark: '#202b25',
    colorLight: '#ffffff',
    correctLevel: window.QRCode.CorrectLevel.H,
  });
}

document.querySelector('#qr-open').addEventListener('click', () => {
  renderQrCode();
  qrDialog.showModal();
});
document.querySelector('#close-qr').addEventListener('click', () => qrDialog.close());
qrDialog.addEventListener('click', (event) => {
  if (event.target === qrDialog) qrDialog.close();
});
document.querySelector('#download-qr').addEventListener('click', () => {
  const canvas = qrCode.querySelector('canvas');
  const image = qrCode.querySelector('img');
  const imageUrl = canvas?.toDataURL('image/png') || image?.src;
  if (!imageUrl) return;
  const downloadLink = document.createElement('a');
  downloadLink.href = imageUrl;
  downloadLink.download = 'aqua-chemi-customer-stock-qr.png';
  downloadLink.click();
});
document.querySelector('#copy-catalog-link').addEventListener('click', async () => {
  const catalogUrl = getCatalogUrl();
  if (!catalogUrl) return;
  try {
    await navigator.clipboard.writeText(catalogUrl);
    showToast('Customer catalog link copied');
  } catch {
    showToast('Copy is unavailable in this browser. Use the displayed catalog link.');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
});