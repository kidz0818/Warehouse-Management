# Warehouse UI/UX Suggestions

1. Make the first screen only about the next action.
   The current app still asks the user to visually parse too many panels. The default screen should focus on three actions: search product, add stock, and open current Rack. Everything else can live behind bottom tabs or drawers.

2. Replace the top search/filter block with a compact command bar.
   Search, Rack switch, and filter should become one sticky compact bar: Rack selector on the left, search in the middle, filter icon on the right. It should use one row on mobile and never push inventory content down too far.

3. Turn "add stock" into a fast step-by-step sheet.
   Adding inventory should feel like: choose photo/product, enter quantity, choose Slot, save. The current form shows too many fields at once. Hide image URL under "advanced" because daily use is camera/photo upload.

4. Make Slot selection visual and searchable inside add/move flows.
   When adding or moving stock, choosing a Slot from a long dropdown is slow. Use grouped Slot chips by section, plus a small search box. Recently used Slots should appear first.

5. Make inventory rows denser but clearer.
   Each row should show product image, name, quantity controls, current Slot, and move target. Archive/delete should be tucked behind a small more menu so dangerous actions do not compete with daily actions.

6. Add a "today's work" queue.
   After adding stock, keep the user in a lightweight queue showing what was just added or moved today. This helps confirm that the work was recorded without opening operation history.

7. Use one detail drawer for view and edit.
   Product detail should open from any row and contain image, quantity, locations, history, and edit fields. Avoid separate modal patterns for similar tasks; repeated patterns make the system feel calmer.

8. Add success feedback after every save.
   After add, move, edit, delete, or import, show a short success toast like "Added 5 to A2" or "Moved 3 to C1". Right now failed actions are clearer than successful actions.

9. Make admin feel like maintenance, not a second app.
   Admin should be a simple maintenance tab with sections: Rack & Slot, Import, Data Health, History. Avoid showing long IDs by default; IDs can be hidden behind an expand/copy action.

10. Optimize for one-handed mobile use.
    Primary actions should sit in the bottom half of the screen. Bottom sheets need enough safe-area padding, large tap targets, and no required controls hidden behind the bottom navigation.
