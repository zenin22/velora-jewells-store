/* Velora storefront enhancements — depends on the existing store catalogue/cart functions. */
(()=>{
 const $=id=>document.getElementById(id);
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN');
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const search=$('searchOverlay'),input=$('storeSearchInput'),results=$('searchResults'),hint=$('searchHint');
 function openSearch(){search.classList.add('open');search.setAttribute('aria-hidden','false');setTimeout(()=>input.focus(),50);renderSearch('')}
 function closeSearch(){search.classList.remove('open');search.setAttribute('aria-hidden','true')}
 $('openSearch')?.addEventListener('click',openSearch);$('closeSearch')?.addEventListener('click',closeSearch);
 search?.addEventListener('click',e=>{if(e.target===search)closeSearch()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSearch()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch()}});
 function renderSearch(query){
  const q=query.trim().toLowerCase(),items=(window.allProducts||allProducts||[]).filter(p=>!q||[p.name,p.category,p.description].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,30);
  hint.textContent=q?(items.length+' matching pieces'):'Search by product name or category.';
  results.innerHTML=items.length?items.map(p=>'<button class="search-result" type="button" data-search-product="'+safe(p.id)+'">'+(p.image_url?'<img src="'+safe(p.image_url)+'" alt="">':'<span class="search-result-placeholder">✧</span>')+'<span><strong>'+safe(p.name)+'</strong><small>'+safe(p.category||'Velora Jewells')+'</small></span><b>'+money(p.price_inr)+'</b></button>').join(''):(q?'<div class="shelf-empty">No pieces found. Try another name or category.</div>':'<div class="shelf-empty">Products will appear here as soon as the catalogue loads.</div>');
 }
 input?.addEventListener('input',()=>renderSearch(input.value));
 results?.addEventListener('click',e=>{const b=e.target.closest('[data-search-product]');if(!b)return;closeSearch();openProductDetail(b.dataset.searchProduct)});
 function shelfCard(p){
  const sold=Boolean(p.is_sold_out)||Number(p.stock_quantity)<=0,discount=Number(p.compare_at_price_inr)>Number(p.price_inr);
  return '<article class="shelf-card"><div class="shelf-photo" data-open-product="'+safe(p.id)+'">'+(p.image_url?'<img loading="lazy" src="'+safe(p.image_url)+'" alt="'+safe(p.name)+'">':'<div class="product-img">✧</div>')+'</div><div class="shelf-info"><small>'+safe(p.category||'Velora')+'</small><h3>'+safe(p.name)+'</h3><div class="shelf-price">'+money(p.price_inr)+(discount?'<del>'+money(p.compare_at_price_inr)+'</del>':'')+'</div><div class="shelf-actions"><button class="shelf-add" type="button" data-shelf-add="'+safe(p.id)+'" '+(sold?'disabled':'')+'>'+(sold?'Sold Out':'Add to bag')+'</button><button class="shelf-add shelf-order" type="button" data-shelf-order="'+safe(p.id)+'" '+(sold?'disabled':'')+'>'+(sold?'Sold Out':'Order Now')+'</button></div></div></article>';
 }
 function renderShelves(){
  const list=allProducts||[];
  const fresh=list.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,8);
  const featured=list.filter(p=>p.is_featured).slice(0,8);
  $('newDropsGrid').innerHTML=fresh.length?fresh.map(shelfCard).join(''):'<div class="shelf-empty">New arrivals will appear here when products are published.</div>';
  $('mostLovedGrid').innerHTML=featured.length?featured.map(shelfCard).join(''):'<div class="shelf-empty">Velora favourites will appear here when you mark products as Featured in the Store Manager.</div>';
 }
 document.addEventListener('click',e=>{
  const open=e.target.closest('[data-open-product]');if(open){openProductDetail(open.dataset.openProduct);return}
  const order=e.target.closest('[data-shelf-order]');if(order){const p=allProducts.find(x=>String(x.id)===order.dataset.shelfOrder);if(!p||p.stock_quantity<1)return;localStorage.setItem('velora_buy_now',JSON.stringify({id:String(p.id),quantity:1}));logEvent('checkout_started',p.id);location.href='checkout.html?buy=1';return}
  const add=e.target.closest('[data-shelf-add]');if(add){const p=allProducts.find(x=>String(x.id)===add.dataset.shelfAdd);if(!p||p.stock_quantity<1)return;cart[p.id]=Math.min((cart[p.id]||0)+1,p.stock_quantity);saveCart();logEvent('add_to_cart',p.id);toast('Added to your bag')}
  const all=e.target.closest('[data-show-all]');if(all){activeProductView='all';activeCategory='All';renderProducts();document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.category==='All'))}
 });
 const originalRender=renderProducts;
 renderProducts=function(){originalRender();renderShelves();if(search?.classList.contains('open'))renderSearch(input.value)};
 const originalLoad=loadProducts;
 loadProducts=async function(){await originalLoad();renderShelves()};
 if(Array.isArray(allProducts)&&allProducts.length)renderShelves();
})();

const shelfStyle=document.createElement('style');shelfStyle.textContent='.shelf-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.shelf-actions .shelf-add{padding:10px 5px}.shelf-actions .shelf-order{background:linear-gradient(135deg,#d5b58b,#9e794e);color:#10090a;border-color:#d5b58b}';document.head.appendChild(shelfStyle);
