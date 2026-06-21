# Warehouse System Optimization Suggestions

1. Add a daily intake workflow.
   New stock should enter through a simple "today received" queue before being assigned to a final Slot. This prevents unarranged products from disappearing into the main inventory.

2. Add split movement as a primary action.
   Moving part of a quantity should be as easy as moving the full row, because real warehouse work often means splitting one product across several boxes or shelves.

3. Add stock audit mode.
   A focused page should show one Rack or Slot at a time with large product photos, expected quantity, and quick confirm/edit buttons for physical counting.

4. Add CSV import and export templates.
   Keep a downloadable sample CSV with `product,quantity,slot,image` so bulk updates can be prepared without guessing the required column names.

5. Add broken image and missing image review.
   Missing or failed product images should have a dedicated cleanup queue, because image quality is what makes visual inventory fast.

6. Add low-stock thresholds per product.
   A default low-stock rule is useful, but some products may need a warning at 2 while others need a warning at 20.

7. Add barcode or QR labels for Slots.
   Each Slot can have a printable QR code. Scanning it should open the app filtered to that Slot, ready to add or audit stock.

8. Add undo for the last destructive action.
   Archive, delete, and move should show a short undo window so accidental taps on mobile are not stressful.

9. Add data health checks to the admin page.
   Track empty Slots, zero-quantity rows, duplicate active records, missing images, and orphaned inventory so cleanup work is obvious.

10. Add an activity timeline by product.
    Product detail should show quantity changes, moves, image edits, archive/delete actions, and who/when metadata once the system grows.
