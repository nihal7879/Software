-- ============================================================================
-- Master-data lookup tables (Year/Grade, Venue, Exam Board, School)
-- Curated + de-duplicated from the Ankita-Attendance / Final workbooks.
-- These drive the app dropdowns (previously hardcoded in the client).
-- ============================================================================
USE classroom_app;

CREATE TABLE IF NOT EXISTS year_grades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS venues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_boards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Year / Grade
INSERT INTO year_grades (name, sort_order) VALUES
  ('G10',0),('G11',1),('G12',2),('G7',3),('G8',4),('G9',5),
  ('Y1',6),('Y10',7),('Y11',8),('Y12',9),('Y13',10),('Y14',11),
  ('Y6',12),('Y7',13),('Y8',14),('Y9',15);

-- Venue
INSERT INTO venues (name, sort_order) VALUES
  ('Explore',0),('GC',1),('In-Centre',2),('JLT',3),('Offline',4),('Online',5),('Oud Metha',6);

-- Exam Board
INSERT INTO exam_boards (name, sort_order) VALUES
  ('AP',0),('AQA',1),('American',2),('CAIE',3),('CBSE',4),('Edexcel',5),('GCSE',6),
  ('IAL',7),('IB',8),('ICSE',9),('IGCSE',10),('KS3',11),('MYP',12);

-- School
INSERT INTO schools (name, sort_order) VALUES
  ('Cambridge International School',0),('Cherrybrook Technology High School',1),('Dubai British School',2),
  ('Dubai College',3),('Dubai English Speaking College',4),('Dubai International Academy Al Barsha',5),
  ('Dubai International Academy Emirates Hills',6),('GEMS Dubai American Academy',7),('GEMS FirstPoint School',8),
  ('GEMS Founders Al Mizhar',9),('GEMS Founders School',10),('GEMS Modern Academy',11),('GEMS Wellington Academy',12),
  ('GEMS Wellington Academy Al Khail',13),('GEMS Wellington International School',14),('GEMS World Academy',15),
  ('GIS',16),('Hartland International School',17),('Homeschool',18),('ISS International School',19),('ISSIS',20),
  ('JSS International School',21),('Jumeirah College',22),('Jumeirah English Speaking School (JESS)',23),
  ('Jumeirah Primary School',24),('Kent College Dubai',25),('Millfield',26),
  ('NLCS (North London Collegiate School)',27),('Nord Anglia International School',28),
  ('Nord Anglia School Dubai (NAS)',29),('North American International School',30),('Private Tutoring',31),
  ('Repton Nad Al Sheba',32),('Repton School',33),('Sherborne Qatar',34),('Sherborne School',35),
  ('The English College',36),('Wellington College',37);
