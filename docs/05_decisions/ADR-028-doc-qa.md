# ADR-028: Zeptej se dokumentace – RAG nad platnou dokumentací

**Stav:** přijato · 5. 10. 2026

1. **pgvector v existující databázi** (obraz `pgvector/pgvector:pg17` už běží) místo samostatné vektorové databáze –
   žádná další služba, zálohy a obnova zůstávají stejné. Rozšíření zakládá vlastní migrace `0024_pgvector_extension`.
   Sloupec `vector` je bez pevné dimenze (model lze změnit; úseky nese `model`) – index HNSW zatím není potřeba
   (tisíce úseků se prohledají přesně v milisekundách); při růstu lze doplnit pro zvolenou dimenzi.
2. **Embedding na lokálním modelu** (`bge-m3`, vícejazyčný) přes stejného poskytovatele jako chat: OpenAI-kompatibilní
   `/embeddings` (Open WebUI), záložně `/ollama/api/embed`; data neopouštějí síť organizace.
3. **Indexují se jen platné verze** – návrhy a nahrazené verze se do odpovědí nedostanou. Index se obnovuje po schválení
   a plánovačem podle otisku zdrojových textů (`source_hash`), takže se projeví i text dodaný později převodní službou.
4. **Oprávnění před modelem**: kandidátní úseky se filtrují podle práva číst dokument (portál, nebo `policies:read`
   ve společnosti) **před** sestavením kontextu – model nikdy nedostane text, který uživatel nesmí číst.
5. **Hybridní vyhledávání** (vektor + slova bez diakritiky) – přesné termíny a čísla článků najde i slovní shoda; když
   embedding není dostupný, funguje aspoň hledání podle slov (`mode: keyword`).
6. **Odpověď jen z úryvků s citacemi** a výslovně „nenalezeno“ jinak; v UI vždy odkaz na závazné znění. Dotaz se
   zapisuje do auditu (text otázky, použité dokumenty). Dokumenty mohou obsahovat jména osob – zpracovává je jen
   lokální model organizace, nic se neposílá ven.
