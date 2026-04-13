import * as dotenv from 'dotenv';
dotenv.config();
import { printCalibrationReport } from '../services/mlCalibration';

export function runCalibration() {
  printCalibrationReport();
}
