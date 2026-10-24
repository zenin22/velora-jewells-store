-- Index the wishlist product foreign key for efficient admin joins and deletion checks.
create index if not exists wishlist_items_product_id_idx on public.wishlist_items(product_id);
