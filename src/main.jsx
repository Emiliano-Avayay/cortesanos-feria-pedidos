import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = '/api';
const statusOptions = [
  ['nuevo', 'Nuevo'],
  ['visto', 'Visto'],
  ['registrado', 'Registrado'],
  ['preparando', 'Preparando'],
  ['listo_para_retirar', 'Listo para retirar'],
  ['entregado', 'Entregado'],
  ['cancelado', 'Cancelado']
];

function money(value) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function ticketLabel(type) {
  return type === 'vip' ? 'VIP' : 'General';
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

function App() {
  const isAdmin = window.location.pathname.startsWith('/admin-cortesanos');
  return isAdmin ? <AdminPanel /> : <PublicStore />;
}

function PublicStore() {
  const [config, setConfig] = useState(null);
  const [wines, setWines] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todos');
  const [accessFilter, setAccessFilter] = useState('Todos');
  const [wineryFilter, setWineryFilter] = useState('Todas');
  const [varietalFilter, setVarietalFilter] = useState('Todas');
  const [cart, setCart] = useState(() => JSON.parse(localStorage.getItem('cc_cart') || '[]'));
  const [cartOpen, setCartOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    Promise.all([api('/config'), api('/wines')])
      .then(([configData, winesData]) => {
        setConfig(configData);
        setWines(winesData.wines || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem('cc_cart', JSON.stringify(cart));
  }, [cart]);

  const categories = useMemo(() => ['Todos', ...Array.from(new Set(wines.map(w => w.category).filter(Boolean)))], [wines]);
  const wineries = useMemo(() => ['Todas', ...Array.from(new Set(wines.map(w => w.winery).filter(Boolean))).sort()], [wines]);
  const varietals = useMemo(() => ['Todas', ...Array.from(new Set(wines.map(w => w.varietal).filter(Boolean))).sort()], [wines]);

  const filteredWines = useMemo(() => {
    const term = normalize(search);
    return wines.filter(wine => {
      const haystack = normalize(`${wine.name} ${wine.winery} ${wine.varietal}`);
      if (term && !haystack.includes(term)) return false;
      if (category !== 'Todos' && wine.category !== category) return false;
      if (accessFilter === 'VIP' && wine.accessType !== 'vip') return false;
      if (accessFilter === 'General' && wine.accessType !== 'general') return false;
      if (wineryFilter !== 'Todas' && wine.winery !== wineryFilter) return false;
      if (varietalFilter !== 'Todas' && wine.varietal !== varietalFilter) return false;
      return true;
    });
  }, [wines, search, category, accessFilter, wineryFilter, varietalFilter]);

  const vipWines = filteredWines.filter(w => w.accessType === 'vip' && w.featured);
  const generalWines = filteredWines.filter(w => w.accessType === 'general');
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const addToCart = (wine) => {
    setToast('');
    if (!config?.showPrices || !config?.enableOrders) {
      setToast('La venta se habilita durante la feria.');
      return;
    }
    if (typeof wine.discountPrice !== 'number' || wine.discountPrice <= 0) {
      setToast('A este vino todavía le falta cargar precio.');
      return;
    }
    setCart(prev => {
      const existing = prev.find(item => item.productId === wine.id);
      if (existing) return prev.map(item => item.productId === wine.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { productId: wine.id, name: wine.name, accessType: wine.accessType, quantity: 1, unitPrice: wine.discountPrice, image: wine.image }];
    });
    setCartOpen(true);
  };

  const changeQty = (productId, delta) => {
    setCart(prev => prev.map(item => item.productId === productId ? { ...item, quantity: item.quantity + delta } : item).filter(item => item.quantity > 0));
  };

  const clearFilters = () => {
    setSearch(''); setCategory('Todos'); setAccessFilter('Todos'); setWineryFilter('Todas'); setVarietalFilter('Todas');
  };

  if (loading) return <Loading />;
  if (error) return <div className="min-h-screen p-6 text-red-700">{error}</div>;

  const pageStyle = config.catalogBackgroundImage ? { '--catalog-bg-url': `url("${config.catalogBackgroundImage}")` } : undefined;

  return (
    <div className={`catalog-page ${config.catalogBackgroundImage ? 'has-bg' : ''}`} style={pageStyle}>
      <div className="catalog-overlay" />
      <div className="relative z-10 min-h-screen">
        <CatalogHeader config={config} cartCount={cartCount} onOpenCart={() => setCartOpen(true)} />
        <main className="mx-auto grid grid-cols-1 max-w-7xl gap-5 px-3 pb-32 pt-4 md:grid-cols-[240px_minmax(0,1fr)] md:px-5 md:pt-6">
          <CatalogSidebar
            categories={categories}
            category={category}
            setCategory={setCategory}
            accessFilter={accessFilter}
            setAccessFilter={setAccessFilter}
          />
          <section className="min-w-0">
            <CatalogTop
              config={config}
              search={search}
              setSearch={setSearch}
              wineryFilter={wineryFilter}
              setWineryFilter={setWineryFilter}
              varietalFilter={varietalFilter}
              setVarietalFilter={setVarietalFilter}
              wineries={wineries}
              varietals={varietals}
              clearFilters={clearFilters}
              total={filteredWines.length}
            />
            {toast && <button onClick={() => setToast('')} className="my-3 w-full rounded-2xl border border-cort-gold/40 bg-[#201915] px-4 py-3 text-left text-sm text-cort-gold">{toast}</button>}
            {(!config.showPrices || !config.enableOrders) && <ClosedNotice config={config} />}
            <VipSection wines={vipWines} config={config} addToCart={addToCart} />
            <GeneralSection wines={generalWines} config={config} addToCart={addToCart} />
          </section>
        </main>
        <Cart
          open={cartOpen}
          setOpen={setCartOpen}
          cart={cart}
          changeQty={changeQty}
          setCart={setCart}
          config={config}
          setConfirmation={setConfirmation}
        />
        {confirmation && <Confirmation confirmation={confirmation} onClose={() => setConfirmation(null)} />}
      </div>
    </div>
  );
}


function Loading() {
  return <div className="grid min-h-screen place-items-center bg-[#0f0c0a] text-cort-gold">Cargando catálogo...</div>;
}

function CatalogHeader({ config, cartCount, onOpenCart }) {
  return (
    <header className="sticky top-0 z-40 border-b border-cort-gold/20 bg-[#11100f]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-cort-gold">Los Cortesanos</p>
          <h1 className="font-display text-2xl leading-none text-white">{config.eventName}</h1>
        </div>
        <div className="hidden text-right text-[12px] text-white/60 sm:block">
          <p>{config.eventDate} · {config.eventTime}</p>
          <p>{config.eventLocation}</p>
        </div>
        <button onClick={onOpenCart} className="rounded-full border border-cort-gold/40 bg-cort-gold px-4 py-2 text-sm font-semibold text-[#17110d]">
          Pedido {cartCount ? `(${cartCount})` : ''}
        </button>
      </div>
    </header>
  );
}

function CatalogSidebar({ categories, category, setCategory, accessFilter, setAccessFilter }) {
  return (
    <aside className="catalog-sidebar">
      <p className="mb-3 text-xs uppercase tracking-[0.25em] text-cort-gold">Categorías</p>
      <div className="flex gap-2 overflow-x-auto pb-1 md:block md:space-y-2 md:overflow-visible md:pb-0">
        {categories.map(cat => (
          <button key={cat} onClick={() => setCategory(cat)} className={`side-chip ${category === cat ? 'side-chip-active' : ''}`}>{cat}</button>
        ))}
      </div>
      <p className="mb-3 mt-5 hidden text-xs uppercase tracking-[0.25em] text-cort-gold md:block">Selección</p>
      <div className="hidden space-y-2 md:block">
        {[['Todos', 'Todos'], ['VIP', 'Destacados'], ['General', 'Generales']].map(([value, label]) => (
          <button key={value} onClick={() => setAccessFilter(value)} className={`side-chip ${accessFilter === value ? 'side-chip-active' : ''}`}>{label}</button>
        ))}
      </div>
    </aside>
  );
}

function CatalogTop(props) {
  const {
    config, search, setSearch,
    wineryFilter, setWineryFilter, varietalFilter, setVarietalFilter,
    wineries, varietals, clearFilters, total
  } = props;

  return (
    <div className="catalog-top">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-cort-gold">Catálogo exclusivo de feria</p>
          <h2 className="mt-2 font-display text-4xl leading-none text-white sm:text-5xl">Elegí tus vinos y armá tu pedido</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">{config.eventSubtitle}</p>
        </div>
        <VoucherInfo config={config} />
      </div>
      <div className="mt-5 rounded-[1.6rem] border border-cort-gold/20 bg-black/35 p-3 backdrop-blur">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cort-gold">⌕</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar vino, bodega o varietal"
            className="w-full rounded-2xl border border-cort-gold/25 bg-[#191512] px-10 py-4 text-base text-white outline-none placeholder:text-white/40 focus:border-cort-gold"
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <select value={wineryFilter} onChange={e => setWineryFilter(e.target.value)} className="select-dark">
            {wineries.map(w => <option key={w} value={w}>{w === 'Todas' ? 'Todas las bodegas' : w}</option>)}
          </select>
          <select value={varietalFilter} onChange={e => setVarietalFilter(e.target.value)} className="select-dark">
            {varietals.map(v => <option key={v} value={v}>{v === 'Todas' ? 'Todos los varietales' : v}</option>)}
          </select>
          <button onClick={clearFilters} className="rounded-2xl border border-cort-gold/25 px-4 py-3 text-sm text-cort-gold">Limpiar</button>
        </div>
        <p className="mt-3 text-xs text-white/50">{total} etiquetas encontradas</p>
      </div>
    </div>
  );
}

function VoucherInfo({ config }) {
  const generalVoucher = money(config.vouchers?.general || 0);
  const vipVoucher = money(config.vouchers?.vip || 0);
  const vipLimit = Number(config.vipVoucherLimit || config.ticketAccess?.vipVoucherLimit || 50);
  return (
    <div className="access-box access-ok">
      <p className="text-xs uppercase tracking-[0.25em] text-cort-gold">Voucher</p>
      <p className="mt-1 text-lg font-semibold text-white">General por defecto</p>
      <p className="mt-1 text-sm leading-5 text-white/70">
        En el checkout se aplica el voucher General de <strong className="text-cort-gold">{generalVoucher}</strong>.
        Si tenés voucher VIP, lo cargás al finalizar y se aplica <strong className="text-cort-gold">{vipVoucher}</strong>.
      </p>
      <p className="mt-2 rounded-xl bg-black/25 px-3 py-2 text-xs text-white/55">Límite VIP configurado: {vipLimit} pedidos.</p>
    </div>
  );
}

function ClosedNotice({ config }) {
  const text = !config.showPrices ? 'Los precios están cargados pero ocultos. Se publican con showPrices: true.' : 'Venta exclusiva disponible durante la feria.';
  return <div className="mb-4 mt-4 rounded-2xl border border-cort-gold/25 bg-black/35 px-4 py-3 text-sm text-white/70">{text}</div>;
}

function VipSection({ wines, config, addToCart }) {
  return (
    <section className="mt-5 rounded-[1.8rem] border border-cort-gold/25 bg-[#15110e]/92 p-4 shadow-premium sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cort-gold">Selección destacada</p>
          <h3 className="mt-1 font-display text-3xl text-white">Vinos recomendados para la experiencia VIP</h3>
          <p className="mt-2 max-w-2xl text-sm text-white/70">Etiquetas de mayor nivel y bodegas destacadas. Las puede comprar cualquier cliente; el código solo define el voucher General o VIP.</p>
        </div>
        <span className="rounded-full border border-cort-gold/30 px-3 py-2 text-xs text-cort-gold">Compra habilitada para todos</span>
      </div>
      {wines.length ? (
        <div className="catalog-grid">
          {wines.map(wine => <WineCard key={wine.id} wine={wine} config={config} addToCart={addToCart} variant="vip" />)}
        </div>
      ) : <p className="rounded-2xl bg-white/5 p-4 text-sm text-white/50">No hay etiquetas destacadas con esos filtros.</p>}
    </section>
  );
}

function GeneralSection({ wines, config, addToCart }) {
  return (
    <section className="mt-5 rounded-[1.8rem] border border-white/8 bg-[#f7f0e4]/95 p-4 shadow-premium sm:p-5">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.3em] text-cort-wine">Catálogo general</p>
        <h3 className="mt-1 font-display text-3xl text-cort-ink">Etiquetas disponibles</h3>
        <p className="mt-2 max-w-2xl text-sm text-cort-ink/70">Buscá el vino, revisá precio de feria cuando esté habilitado y agregalo al carrito.</p>
      </div>
      {wines.length ? (
        <div className="catalog-grid">
          {wines.map(wine => <WineCard key={wine.id} wine={wine} config={config} addToCart={addToCart} />)}
        </div>
      ) : <p className="rounded-2xl bg-white p-5 text-sm text-cort-ink/60">No hay etiquetas generales con esos filtros.</p>}
    </section>
  );
}

function WineCard({ wine, config, addToCart, variant = 'general' }) {
  const [broken, setBroken] = useState(false);
  const isHighlighted = wine.accessType === 'vip';
  const hasPrice = typeof wine.discountPrice === 'number' && wine.discountPrice > 0;
  const canOrder = config.showPrices && config.enableOrders && hasPrice;
  const cardClass = variant === 'vip' ? 'product-card product-card-vip' : 'product-card';

  let cta = 'Agregar';
  if (!config.enableOrders || !config.showPrices) cta = 'Próximo';
  else if (!hasPrice) cta = 'Sin precio';

  return (
    <article className={cardClass}>
      <div className="product-image">
        {!broken && wine.image ? <img src={wine.image} alt={wine.name} onError={() => setBroken(true)} loading="lazy" /> : <PlaceholderBottle />}
      </div>

      <div className="product-content">
        <div className="product-meta-row">
          {isHighlighted && <span className="badge-vip">Destacado</span>}
          <span className="badge-soft">{wine.category}</span>
        </div>

        <h4 className="product-title">{wine.name}</h4>
        <div className="product-details">
          <span>{wine.winery}</span>
          {wine.varietal && <span>{wine.varietal}</span>}
        </div>

        <div className="product-bottom">
          <div className="product-price-block">
            {config.showPrices ? (
              hasPrice ? <>
                {typeof wine.suggestedPrice === 'number' && wine.suggestedPrice > 0 && <p className="price-before">Antes {money(wine.suggestedPrice)}</p>}
                <p className="price-main">{money(wine.discountPrice)}</p>
              </> : <p className="price-muted">Precio a cargar</p>
            ) : <p className="price-muted">Precio exclusivo durante la feria</p>}
          </div>
          <button onClick={() => addToCart(wine)} disabled={!canOrder} className="product-add disabled:cursor-not-allowed disabled:opacity-45">{cta}</button>
        </div>
      </div>
    </article>
  );
}

function PlaceholderBottle() {
  return <div className="grid h-full place-items-center text-center text-[10px] uppercase tracking-[0.15em] text-cort-gold">Imagen<br />próxima</div>;
}

function Cart({ open, setOpen, cart, changeQty, setCart, config, setConfirmation }) {
  const [customer, setCustomer] = useState({ name: '', phone: '', ticketNumber: '', comment: '' });
  const [wantsVipVoucher, setWantsVipVoucher] = useState(false);
  const [vipCode, setVipCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const selectedVoucherType = wantsVipVoucher ? 'vip' : 'general';
  const voucher = Math.min(Number(config.vouchers?.[selectedVoucherType] || 0), subtotal);
  const total = Math.max(0, subtotal - voucher);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const active = config.showPrices && config.enableOrders;
  const vipLimit = Number(config.vipVoucherLimit || config.ticketAccess?.vipVoucherLimit || 50);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!active) return setError('La venta todavía no está activa.');
    if (!cart.length) return setError('Agregá al menos un vino al pedido.');
    if (wantsVipVoucher && vipCode.trim().length < 3) return setError('Ingresá el código de voucher VIP.');
    setSubmitting(true);
    try {
      const data = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer: {
            ...customer,
            ticketType: selectedVoucherType,
            ticketCode: wantsVipVoucher ? vipCode : '',
            wantsVipVoucher
          },
          items: cart.map(item => ({ productId: item.productId, quantity: item.quantity }))
        })
      });
      setCart([]);
      setOpen(false);
      setConfirmation(data);
      setTimeout(() => window.open(data.whatsappUrl, '_blank', 'noopener,noreferrer'), 100);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 right-4 z-40 rounded-full border border-cort-gold/35 bg-[#14100d] px-5 py-4 text-sm font-semibold text-white shadow-premium sm:left-auto sm:right-8 sm:w-[380px]">
        Tu pedido · {count} producto{count !== 1 ? 's' : ''}{active ? ` · ${money(total)}` : ''}
      </button>
      <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} onClick={() => setOpen(false)} />
        <aside className={`absolute bottom-0 right-0 flex max-h-[92vh] w-full flex-col rounded-t-[2rem] bg-[#f8f1e7] p-4 shadow-premium transition-transform sm:bottom-4 sm:right-4 sm:max-h-[calc(100vh-2rem)] sm:max-w-md sm:rounded-[2rem] ${open ? 'translate-y-0' : 'translate-y-full sm:translate-y-[110%]'}`}>
          <div className="flex items-center justify-between border-b border-black/10 pb-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cort-wine">Carrito</p>
              <h3 className="font-display text-3xl">Tu pedido</h3>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-full border border-black/10 px-3 py-2 text-sm">Cerrar</button>
          </div>
          <div className="flex-1 overflow-y-auto py-4">
            <div className="mb-4 rounded-2xl bg-[#18130f] p-3 text-sm text-white/70">
              Voucher seleccionado: <strong className="text-cort-gold">{wantsVipVoucher ? 'VIP' : 'General'}</strong>
              <span> · {money(config.vouchers?.[selectedVoucherType] || 0)}</span>
            </div>
            {!active && <div className="mb-4 rounded-2xl border border-cort-gold/20 bg-white p-3 text-sm text-cort-ink/70">Venta exclusiva disponible durante la feria.</div>}
            {cart.length === 0 ? <p className="text-sm text-cort-ink/60">Todavía no agregaste productos.</p> : cart.map(item => (
              <div key={item.productId} className="mb-3 rounded-2xl border border-black/10 bg-white p-3">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-cort-ink/60">{item.accessType === 'vip' ? 'Destacado' : 'General'} · {money(item.unitPrice)}</p>
                  </div>
                  <p className="font-semibold">{money(item.unitPrice * item.quantity)}</p>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button className="qty-button" onClick={() => changeQty(item.productId, -1)}>-</button>
                  <span className="min-w-8 text-center">{item.quantity}</span>
                  <button className="qty-button" onClick={() => changeQty(item.productId, 1)}>+</button>
                </div>
              </div>
            ))}
            {active && cart.length > 0 && (
              <div className="rounded-2xl bg-white p-4 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
                <div className="mt-2 flex justify-between text-cort-wine"><span>Voucher {wantsVipVoucher ? 'VIP' : 'General'}</span><strong>-{money(voucher)}</strong></div>
                <div className="mt-3 flex justify-between border-t border-black/10 pt-3 text-lg"><span>Total final</span><strong>{money(total)}</strong></div>
              </div>
            )}
            <form onSubmit={submit} className="mt-4 space-y-3">
              <div className="rounded-2xl border border-cort-gold/25 bg-[#18130f] p-3 text-sm leading-5 text-white/75">
                Para evitar errores, usá el mismo <strong className="text-white">nombre y apellido</strong> y el mismo <strong className="text-white">número de WhatsApp</strong> con el que compraste la entrada.
              </div>
              <input required value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} placeholder="Nombre y apellido igual al de la entrada" className="input-field" />
              <input required value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} placeholder="WhatsApp igual al de la entrada" className="input-field" />

              <div className="rounded-2xl border border-black/10 bg-white p-3">
                <p className="text-sm font-semibold text-cort-ink">¿Tenés voucher VIP?</p>
                <p className="mt-1 text-xs leading-5 text-cort-ink/60">
                  Si no cargás código VIP, el pedido queda automáticamente como General con voucher de {money(config.vouchers?.general || 0)}.
                  El voucher VIP tiene cupo máximo de {vipLimit} pedidos y código de un solo uso.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setWantsVipVoucher(false); setVipCode(''); }} className={`voucher-choice ${!wantsVipVoucher ? 'voucher-choice-active' : ''}`}>No, General</button>
                  <button type="button" onClick={() => setWantsVipVoucher(true)} className={`voucher-choice ${wantsVipVoucher ? 'voucher-choice-active' : ''}`}>Sí, VIP</button>
                </div>
                {wantsVipVoucher && (
                  <input
                    value={vipCode}
                    onChange={e => setVipCode(e.target.value)}
                    placeholder="Código voucher VIP"
                    className="input-field mt-3 uppercase"
                  />
                )}
              </div>

              <input value={customer.ticketNumber} onChange={e => setCustomer({ ...customer, ticketNumber: e.target.value })} placeholder="N° de entrada o comprobante (opcional)" className="input-field" />
              <textarea value={customer.comment} onChange={e => setCustomer({ ...customer, comment: e.target.value })} placeholder="Comentario opcional" className="input-field min-h-[88px]" />
              {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              <button disabled={!active || submitting || !cart.length} className="w-full rounded-2xl bg-cort-wine px-5 py-4 font-semibold text-white disabled:opacity-40">
                {submitting ? 'Enviando...' : 'Confirmar pedido y abrir WhatsApp'}
              </button>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}

function Confirmation({ confirmation, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
      <div className="max-w-md rounded-[2rem] bg-[#f8f1e7] p-6 text-center shadow-premium">
        <p className="text-xs uppercase tracking-[0.25em] text-cort-wine">Pedido recibido</p>
        <h3 className="mt-2 font-display text-4xl">{confirmation.orderNumber}</h3>
        <p className="mt-3 text-sm leading-6 text-cort-ink/70">Nos vamos a contactar para confirmar disponibilidad y entrega durante la feria.</p>
        <a href={confirmation.whatsappUrl} target="_blank" rel="noreferrer" className="mt-5 block rounded-2xl bg-cort-wine px-5 py-3 font-semibold text-white">Abrir WhatsApp</a>
        <button onClick={onClose} className="mt-3 text-sm text-cort-ink/60">Cerrar</button>
      </div>
    </div>
  );
}

function AdminPanel() {
  const [auth, setAuth] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    api('/admin/me').then(() => setAuth(true)).catch(() => setAuth(false)).finally(() => setChecking(false));
  }, []);
  if (checking) return <Loading />;
  return auth ? <OrdersDashboard onLogout={() => setAuth(false)} /> : <AdminLogin onLogin={() => setAuth(true)} />;
}

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await api('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      onLogin();
    } catch (err) { setError(err.message); }
  };
  return (
    <div className="grid min-h-screen place-items-center bg-[#100d0b] p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-[2rem] border border-cort-gold/20 bg-[#19130f] p-6 shadow-premium">
        <p className="text-xs uppercase tracking-[0.25em] text-cort-gold">Panel privado</p>
        <h1 className="mt-2 font-display text-4xl text-white">Cultura Cortesana</h1>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña" className="input-dark mt-5" />
        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="mt-4 w-full rounded-2xl bg-cort-gold px-5 py-3 font-semibold text-[#17110d]">Entrar</button>
      </form>
    </div>
  );
}

function OrdersDashboard({ onLogout }) {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');

  const load = () => api('/admin/orders').then(data => setOrders(data.orders || [])).catch(err => setError(err.message));
  useEffect(() => {
    load();
    const source = new EventSource('/api/admin/orders/stream', { withCredentials: true });
    source.addEventListener('orders', event => setOrders(JSON.parse(event.data).orders || []));
    source.onerror = () => {};
    const interval = setInterval(load, 5000);
    return () => { source.close(); clearInterval(interval); };
  }, []);

  const updateStatus = async (order, status) => {
    const data = await api(`/admin/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    setOrders(prev => prev.map(o => o.id === order.id ? data.order : o));
  };
  const updateNote = async (order, internalNote) => {
    const data = await api(`/admin/orders/${order.id}/note`, { method: 'PATCH', body: JSON.stringify({ internalNote }) });
    setOrders(prev => prev.map(o => o.id === order.id ? data.order : o));
  };
  const logout = async () => { await api('/admin/logout', { method: 'POST' }).catch(() => null); onLogout(); };

  return (
    <div className="min-h-screen bg-[#100d0b] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cort-gold">Panel administrador</p>
            <h1 className="font-display text-5xl">Pedidos</h1>
          </div>
          <button onClick={logout} className="rounded-full border border-cort-gold/20 bg-white/5 px-4 py-2 text-sm">Salir</button>
        </div>
        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        <div className="grid gap-4">
          {orders.length === 0 ? <div className="rounded-[2rem] border border-cort-gold/20 bg-white/5 p-6 text-white/60">Todavía no hay pedidos.</div> : orders.map(order => (
            <OrderCard key={order.id} order={order} updateStatus={updateStatus} updateNote={updateNote} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order, updateStatus, updateNote }) {
  const [note, setNote] = useState(order.internalNote || '');
  useEffect(() => setNote(order.internalNote || ''), [order.internalNote]);
  return (
    <article className="rounded-[2rem] border border-cort-gold/20 bg-[#f8f1e7] p-4 text-cort-ink shadow-premium sm:p-5">
      <div className="flex flex-wrap justify-between gap-3 border-b border-black/10 pb-4">
        <div>
          <h2 className="font-display text-3xl">{order.orderNumber}</h2>
          <p className="text-sm text-cort-ink/60">{new Date(order.createdAt).toLocaleString('es-AR')}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.18em] text-cort-wine">Total final</p>
          <p className="text-2xl font-semibold text-cort-wine">{money(order.finalTotal)}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_260px]">
        <div>
          <p className="font-semibold">{order.customer.name}</p>
          <p className="text-sm text-cort-ink/60">WhatsApp: {order.customer.phone}</p>
          <p className="text-sm text-cort-ink/60">Entrada: {order.customer.ticketType === 'vip' ? 'VIP' : 'General'} · Código/N°: {order.customer.ticketNumber || '-'}</p>
          {order.customer.comment && <p className="mt-2 rounded-xl bg-white p-3 text-sm">{order.customer.comment}</p>}
        </div>
        <div className="space-y-2">
          {order.items.map((item, index) => (
            <div key={`${item.productId}-${index}`} className="flex justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm">
              <span>{item.quantity} x {item.name}</span>
              <strong>{money(item.total)}</strong>
            </div>
          ))}
          <div className="text-sm text-cort-ink/70">
            <p>Subtotal: {money(order.subtotal)}</p>
            <p>Voucher: -{money(order.voucherAmount)}</p>
          </div>
        </div>
        <div>
          <select value={order.status} onChange={e => updateStatus(order, e.target.value)} className="select-field w-full">
            {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Nota interna" className="input-field mt-3 min-h-[96px]" />
          <button onClick={() => updateNote(order, note)} className="mt-2 w-full rounded-2xl bg-cort-ink px-4 py-3 text-sm font-semibold text-white">Guardar nota</button>
        </div>
      </div>
    </article>
  );
}

createRoot(document.getElementById('root')).render(<App />);
