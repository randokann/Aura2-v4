export const SECTION_COLORS = {
    diario:     { primary: "#E07A5F", hover: "#EC8E77" },  // coral - nutrition
    fotocamera: { primary: "#E07A5F", hover: "#EC8E77" },  // coral - nutrition
    piani:      { primary: "#81B29A", hover: "#9CBEAD" },  // green - planning (existing)
    coach:      { primary: "#6EA8C7", hover: "#87BBD6" },  // steel blue - fitness
    profilo:    { primary: "#D4A373", hover: "#DDB68A" },  // warm sand - user
};

export const sectionStyle = (id) => {
    const c = SECTION_COLORS[id] || SECTION_COLORS.diario;
    return { "--action-primary": c.primary, "--action-hover": c.hover };
};
