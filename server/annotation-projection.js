const unique = (values) => [...new Set((values || []).filter(Boolean))];

export const qualityRank = { suitable: 3, clarification_required: 2, human_review: 1, hidden: 0 };
export const firstTimeRank = { suitable: 3, conditional: 2, unknown: 1, not_suitable: 0 };

export function compareAnnotationRecords(left, right) {
  return (qualityRank[right.semantic.quality.status] - qualityRank[left.semantic.quality.status])
    || (firstTimeRank[right.semantic.firstTimeFit.verdict] - firstTimeRank[left.semantic.firstTimeFit.verdict])
    || ((right.semantic.firstTimeFit.score ?? -1) - (left.semantic.firstTimeFit.score ?? -1))
    || ((left.semantic.complexity.overall ?? 101) - (right.semantic.complexity.overall ?? 101));
}

const themeByCause = {
  animal_welfare: ["animals"], environment: ["ecology", "nature"], urban_improvement: ["city"],
  education_mentoring: ["education"], culture_arts: ["creativity"], sports_wellbeing: ["activity"],
  donor_movement: ["donation"], intellectual_pro_bono: ["online_help"], civic_initiatives: ["events", "city"],
  emergency_response: ["activity"], health_medicine: ["charity"], military_support: ["charity"],
  social_support: ["charity"], mutual_aid: ["charity"], humanitarian_aid: ["charity"],
  elderly_support: ["elderly"], disability_inclusion: ["charity"], nonprofit_support: ["online_help"],
  poverty_crisis_support: ["charity"], homelessness_support: ["charity"], refugee_displaced_support: ["charity"],
};
const themeByBeneficiary = {
  animals: ["animals"], elderly_people: ["elderly"], children: ["children"], youth: ["children"],
  environment: ["ecology", "nature"], cultural_audiences: ["creativity"], sports_participants: ["activity"],
  blood_marrow_recipients: ["donation"], nonprofit_organizations: ["online_help"],
};
const themeByTask = {
  teaching: ["education"], mentoring: ["education"], design_content_smm: ["online_help"],
  administration_data_entry: ["online_help"], it_technical_support: ["online_help"],
  animal_care: ["animals"], dog_walking: ["animals"], medical_donation: ["donation"],
  cleaning_improvement: ["city"], environmental_monitoring: ["ecology", "nature"],
  event_guest_support: ["events"], registration_check_in: ["events"], event_setup_teardown: ["events"],
  sports_marshalling: ["activity"], photography_video: ["creativity"], workshop_facilitation: ["creativity"],
};

export function themesFromAnnotation(record) {
  const semantic = record.semantic;
  const values = [
    ...record.sourceFacts.officialCauseAreas,
    ...semantic.supplementalClassification.supplementalCauseAreas,
  ].flatMap((value) => themeByCause[value] ?? []);
  values.push(...semantic.supplementalClassification.beneficiaryGroups.flatMap((value) => themeByBeneficiary[value] ?? []));
  values.push(...semantic.supplementalClassification.additionalVolunteerTasks.flatMap((value) => themeByTask[value] ?? []));
  return unique(values);
}

export function compactAnnotation(record, alternativesCount = 1) {
  const { semantic, sourceFacts } = record;
  const exactDuration = sourceFacts.period?.exactDurationMinutes ?? null;
  const filterTags = unique([
    semantic.quality.status === "suitable" && semantic.firstTimeFit.verdict === "suitable" ? "first_time" : null,
    semantic.complexity.overall !== null && semantic.complexity.overall <= 39 ? "easy" : null,
    semantic.feedSignals.calmTask === "yes" ? "calm" : null,
    semantic.feedSignals.remoteTask === "yes" && sourceFacts.format === "online" ? "remote" : null,
    semantic.feedSignals.friendsAllowed === "yes" ? "friends" : null,
    semantic.participation.commitment === "one_off" ? "one_off" : null,
    semantic.participation.commitment === "flexible" ? "flexible" : null,
    exactDuration !== null && exactDuration <= 120 ? "short" : null,
    sourceFacts.period?.exactWeekendDate ? "weekend" : null,
  ]);
  return {
    schemaVersion: record.schemaVersion,
    selectedVacancyId: record.vacancyId,
    alternativesCount,
    quality: semantic.quality,
    causeAreas: unique([
      ...sourceFacts.officialCauseAreas,
      ...semantic.supplementalClassification.supplementalCauseAreas,
    ]),
    beneficiaryGroups: semantic.supplementalClassification.beneficiaryGroups,
    volunteerTasks: semantic.supplementalClassification.additionalVolunteerTasks,
    structuredTasks: sourceFacts.structuredTasks.map(({ title }) => title),
    format: sourceFacts.format,
    participation: semantic.participation,
    complexity: semantic.complexity,
    firstTime: semantic.firstTimeFit,
    feedSignals: semantic.feedSignals,
    requirements: semantic.inferredRequirements,
    facts: {
      exactDurationMinutes: exactDuration,
      exactWeekendDate: sourceFacts.period?.exactWeekendDate ?? null,
      minimumAge: sourceFacts.minimumAge,
      prerequisites: sourceFacts.prerequisites,
    },
    shortExplanation: semantic.shortExplanation,
    filterTags,
    themeIds: themesFromAnnotation(record),
  };
}

