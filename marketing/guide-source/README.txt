Khmer feature guides (PDF) for MySoft Attendance.
- guide.html = A4 template; guides-a/b/c/d.js = the Khmer content (one object per guide).
- jpg/ = screenshots; shots/boxes.json = recorded button positions for the orange markers.
- Rebuild: node pdf.mjs ../guides each     (needs Google Chrome; writes 15 guides + the full manual)
- Preview: python prev.py ../guides/03-Employees.pdf 75 all prev   (needs PyMuPDF)
