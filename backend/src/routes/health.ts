import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../db';

const router = Router();

// GET: Retrieve all health metrics for current patient
router.get('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'PATIENT') {
    return res.status(403).json({ message: 'Only patients can access health metrics.' });
  }

  try {
    const metrics = await prisma.healthMetric.findMany({
      where: { patientId: req.user.id },
      orderBy: { recordedAt: 'asc' },
    });
    return res.json(metrics);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// POST: Log a manual health metric
router.post('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'PATIENT') {
    return res.status(403).json({ message: 'Only patients can record health metrics.' });
  }

  const { metricType, value, unit } = req.body;
  if (!metricType || value === undefined) {
    return res.status(400).json({ message: 'metricType and value are required.' });
  }

  try {
    const metric = await prisma.healthMetric.create({
      data: {
        patientId: req.user.id,
        metricType,
        value: parseFloat(value),
        unit,
      },
    });
    return res.status(201).json(metric);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// POST: Analyze pasted medical report or symptoms text (Health-Q Style AI Parser)
router.post('/analyze-report', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'PATIENT') {
    return res.status(403).json({ message: 'Only patients can analyze clinical reports.' });
  }

  const { textContent } = req.body;
  if (!textContent || textContent.trim().length < 5) {
    return res.status(400).json({ message: 'Report text is too short for analysis.' });
  }

  try {
    const text = textContent.toLowerCase();
    
    // Parse key clinical metrics using clinical regex scanners with physiological boundary checks
    const metricsToCreate: { patientId: string; metricType: string; value: number; unit: string }[] = [];
    const findings: { name: string; value: string; unit: string; status: string }[] = [];

    // 1. Pulse
    const pulseMatch = text.match(/(?:pulse|heart\s*rate|hr)[:\s]*(\d{2,3})/i);
    let pulse: number | null = null;
    if (pulseMatch) {
      const parsed = parseInt(pulseMatch[1], 10);
      if (parsed >= 30 && parsed <= 250) {
        pulse = parsed;
        metricsToCreate.push({ patientId: req.user.id, metricType: 'pulse', value: pulse, unit: 'bpm' });
        findings.push({
          name: 'Heart Rate (Pulse)',
          value: `${pulse}`,
          unit: 'bpm',
          status: pulse > 100 ? 'Elevated' : pulse < 60 ? 'Low' : 'Normal',
        });
      }
    }

    // 2. Blood Pressure
    const bpMatch = text.match(/(?:bp|blood\s*pressure)[:\s]*(\d{2,3})\s*\/\s*(\d{2,3})/i);
    let systolic: number | null = null;
    let diastolic: number | null = null;
    if (bpMatch) {
      const s = parseInt(bpMatch[1], 10);
      const d = parseInt(bpMatch[2], 10);
      if (s >= 50 && s <= 300 && d >= 30 && d <= 200 && s > d) {
        systolic = s;
        diastolic = d;
        metricsToCreate.push({ patientId: req.user.id, metricType: 'bp_systolic', value: systolic, unit: 'mmHg' });
        metricsToCreate.push({ patientId: req.user.id, metricType: 'bp_diastolic', value: diastolic, unit: 'mmHg' });
        findings.push({
          name: 'Systolic Blood Pressure',
          value: `${systolic}`,
          unit: 'mmHg',
          status: systolic > 130 ? 'Elevated' : systolic < 90 ? 'Low' : 'Normal',
        });
        findings.push({
          name: 'Diastolic Blood Pressure',
          value: `${diastolic}`,
          unit: 'mmHg',
          status: diastolic > 85 ? 'Elevated' : 'Normal',
        });
      }
    }

    // 3. Blood Glucose
    const glucoseMatch = text.match(/(?:glucose|sugar|bs|fbs|rbs)[:\s]*(\d{2,3})/i);
    let glucose: number | null = null;
    if (glucoseMatch) {
      const g = parseInt(glucoseMatch[1], 10);
      if (g >= 20 && g <= 800) {
        glucose = g;
        metricsToCreate.push({ patientId: req.user.id, metricType: 'blood_glucose', value: glucose, unit: 'mg/dL' });
        findings.push({
          name: 'Blood Glucose',
          value: `${glucose}`,
          unit: 'mg/dL',
          status: glucose > 140 ? 'Elevated' : glucose < 70 ? 'Low' : 'Normal',
        });
      }
    }

    // 4. Weight
    const weightMatch = text.match(/(?:weight|wt)[:\s]*(\d{2,3}(?:\.\d+)?)\s*(?:kg|kilos)?/i);
    if (weightMatch) {
      const w = parseFloat(weightMatch[1]);
      if (w >= 2 && w <= 500) {
        metricsToCreate.push({ patientId: req.user.id, metricType: 'weight', value: w, unit: 'kg' });
        findings.push({
          name: 'Body Weight',
          value: `${w}`,
          unit: 'kg',
          status: 'Normal',
        });
      }
    }

    // If zero clinical vitals were found, do not fabricate measurements or insert mock values
    if (metricsToCreate.length === 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'No valid clinical vital signs (pulse, blood pressure, glucose, or weight) could be extracted from the provided text.',
      });
    }

    // Save only genuine parsed metrics into the DB transactionally
    await prisma.$transaction(
      metricsToCreate.map((m) =>
        prisma.healthMetric.create({
          data: m,
        })
      )
    );

    // AI Summary response parameters matching health findings
    let priority = 'Low';
    let summary = 'Medical report analysis complete. Genuine physiological metrics extracted.';
    let recommendation = 'Maintain regular monitoring and healthy habits.';

    const isHighBP = systolic !== null && systolic > 140;
    const isHighPulse = pulse !== null && pulse > 100;
    const isHighGlucose = glucose !== null && glucose > 140;
    const isLowBP = systolic !== null && systolic < 90;
    const isLowGlucose = glucose !== null && glucose < 70;

    if (isHighBP || isHighPulse || isHighGlucose) {
      priority = 'High';
      summary = 'Caution: Elevated clinical metrics detected in submitted report.';
      recommendation = 'Schedule a follow-up appointment with your physician or cardiologist.';
    } else if (isLowBP || isLowGlucose) {
      priority = 'High';
      summary = 'Caution: Low blood pressure or blood glucose readings detected.';
      recommendation = 'Discuss these readings with your primary healthcare provider promptly.';
    }

    return res.json({
      summary,
      priority,
      keyFindings: findings,
      recommendation,
      disclaimer: 'Clinical parsing tool. Always verify values with a licensed healthcare practitioner.',
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

export default router;
