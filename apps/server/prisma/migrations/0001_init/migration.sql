-- Lap Timer initial schema. Requires PostGIS (the docker-compose image includes it).
CREATE EXTENSION IF NOT EXISTS postgis;

-- Monotonic change counter shared by all synced tables (incremental sync cursor).
CREATE SEQUENCE IF NOT EXISTS sync_seq;

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Circuit" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "lengthM" DOUBLE PRECISION NOT NULL,
    "geometry" JSONB NOT NULL,
    "geom" geography(LineString, 4326),
    "waypoints" JSONB NOT NULL,
    "routing" JSONB,
    "elevation" JSONB,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,
    "deletedAt" DOUBLE PRECISION,
    "seq" BIGINT NOT NULL,

    CONSTRAINT "Circuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingLine" (
    "circuitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "aLat" DOUBLE PRECISION NOT NULL,
    "aLon" DOUBLE PRECISION NOT NULL,
    "bLat" DOUBLE PRECISION NOT NULL,
    "bLon" DOUBLE PRECISION NOT NULL,
    "direction" INTEGER NOT NULL,

    CONSTRAINT "TimingLine_pkey" PRIMARY KEY ("circuitId","kind","idx")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "circuitId" TEXT NOT NULL,
    "circuitName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" DOUBLE PRECISION NOT NULL,
    "endedAt" DOUBLE PRECISION,
    "marks" JSONB NOT NULL,
    "referenceSessionId" TEXT,
    "referenceLap" INTEGER,
    "updatedAt" DOUBLE PRECISION NOT NULL,
    "deletedAt" DOUBLE PRECISION,
    "seq" BIGINT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lap" (
    "sessionId" TEXT NOT NULL,
    "lap" INTEGER NOT NULL,
    "startT" DOUBLE PRECISION NOT NULL,
    "endT" DOUBLE PRECISION NOT NULL,
    "timeMs" DOUBLE PRECISION NOT NULL,
    "sectorTimesMs" DOUBLE PRECISION[],
    "distanceM" DOUBLE PRECISION NOT NULL,
    "avgSpeedMs" DOUBLE PRECISION NOT NULL,
    "maxSpeedMs" DOUBLE PRECISION,
    "valid" BOOLEAN NOT NULL,
    "flags" TEXT[],
    "gps" JSONB NOT NULL,
    "trace" JSONB NOT NULL,

    CONSTRAINT "Lap_pkey" PRIMARY KEY ("sessionId","lap")
);

-- CreateTable
CREATE TABLE "GpsSample" (
    "sessionId" TEXT NOT NULL,
    "t" DOUBLE PRECISION NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "altitudeAccuracy" DOUBLE PRECISION,

    CONSTRAINT "GpsSample_pkey" PRIMARY KEY ("sessionId","t")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "deviceId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("deviceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Circuit_ownerId_seq_idx" ON "Circuit"("ownerId", "seq");

-- CreateIndex
CREATE INDEX "Session_ownerId_seq_idx" ON "Session"("ownerId", "seq");

-- CreateIndex
CREATE INDEX "Session_circuitId_idx" ON "Session"("circuitId");

-- CreateIndex
CREATE INDEX "Lap_sessionId_timeMs_idx" ON "Lap"("sessionId", "timeMs");

-- AddForeignKey
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingLine" ADD CONSTRAINT "TimingLine_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lap" ADD CONSTRAINT "Lap_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsSample" ADD CONSTRAINT "GpsSample_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Spatial index for "circuits near me" queries.
CREATE INDEX "Circuit_geom_idx" ON "Circuit" USING GIST ("geom");
